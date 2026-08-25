/**
 * Phase 9 — Desktop control runner (v2).
 * Screenshot capture + input automation, with screen understanding via
 * describeScreen() from the shared llama.cpp client (single vision-capable
 * model — no separate vision integration).
 *
 * Two platform backends:
 *   win32 — PowerShell (.NET CopyFromScreen, SendKeys, user32 mouse_event)
 *   linux — XDG desktop portal for capture, ydotool (uinput) for input,
 *           gio/gtk-launch/xdg-open for launching apps. See docs/06-SETUP-GUIDE.md §9.
 */
const { execSync, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const PORTAL_SCRIPT = path.join(__dirname, 'portal_screenshot.py');

let _describeScreen = null;
function getDescribeScreen() {
  if (!_describeScreen) {
    // Lazy require so this module can be loaded without the model server running
    ({ describeScreen } = require('../../model/llamacppClient'));
    _describeScreen = describeScreen;
  }
  return _describeScreen;
}

// ── Screenshot ──────────────────────────────────────────────────────────────

/** Capture the full virtual screen to a PNG Buffer via .NET CopyFromScreen. */
function screenshotWindows() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
`;
  const b64 = execSync('powershell -NoProfile -NonInteractive -Command -', { input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  const line = b64.split('\n').filter(l => l.trim()).pop();
  return Buffer.from(line, 'base64');
}

/**
 * Capture via the XDG desktop portal. Wayland compositors do not expose the
 * screen to ordinary X11 grabs (`import -window root` returns nothing), and
 * GNOME 47+ rejects direct org.gnome.Shell.Screenshot calls, so the portal is
 * the only supported path. Requires an active desktop session on DBUS.
 */
function screenshotLinux() {
  const dest = path.join(os.tmpdir(), `jarwizz-shot-${process.pid}-${Date.now()}.png`);
  try {
    execFileSync(process.env.JARWIZZ_PYTHON || 'python3', [PORTAL_SCRIPT, dest], {
      encoding: 'utf8',
      timeout: 40000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return fs.readFileSync(dest);
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    throw new Error(`screenshot failed (XDG portal): ${detail}`);
  } finally {
    try { fs.rmSync(dest, { force: true }); } catch {}
  }
}

async function takeScreenshot() {
  return IS_WIN ? screenshotWindows() : screenshotLinux();
}

/**
 * Vision-grounded screen reading — captures a screenshot and describes it via
 * the same Qwen3-VL model used for planning (describeScreen built in Phase 1).
 * Returns the raw buffer too so callers that also want the image don't have to
 * capture a second time (on Wayland every capture is a portal round-trip).
 */
async function readScreen(prompt = "Describe what's visible on this screen in one paragraph — list windows, buttons, and any text you can read.") {
  const imageBuffer = await takeScreenshot();
  const describe = getDescribeScreen();
  const description = await describe(imageBuffer, prompt);
  return { description, screenshot: imageBuffer, screenshot_bytes: imageBuffer.length };
}

// ── Launching applications ──────────────────────────────────────────────────

/**
 * Windows app names the planner and stored memories still reach for, mapped to
 * their usual GNOME counterparts. Falls through to the literal name when the
 * user asks for something already installed under its real name.
 */
const LINUX_APP_ALIASES = {
  notepad: ['gnome-text-editor', 'gedit', 'kate'],
  wordpad: ['gnome-text-editor', 'libreoffice'],
  explorer: ['nautilus', 'dolphin', 'thunar'],
  'file explorer': ['nautilus', 'dolphin', 'thunar'],
  files: ['nautilus', 'dolphin', 'thunar'],
  calc: ['gnome-calculator', 'kcalc'],
  calculator: ['gnome-calculator', 'kcalc'],
  cmd: ['gnome-terminal', 'kgx', 'konsole', 'alacritty'],
  terminal: ['kgx', 'gnome-terminal', 'konsole', 'alacritty'],
  powershell: ['kgx', 'gnome-terminal', 'konsole'],
  mspaint: ['gnome-paint', 'pinta', 'krita'],
  chrome: ['google-chrome-stable', 'google-chrome', 'chromium'],
  browser: ['xdg-open-default-browser'],
  settings: ['gnome-control-center', 'systemsettings'],
};

function commandExists(cmd) {
  try {
    execFileSync('/bin/sh', ['-c', `command -v ${JSON.stringify(cmd)}`], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/** Find an installed .desktop entry whose id or Name matches `name`. */
function findDesktopEntry(name) {
  const dirs = [
    path.join(os.homedir(), '.local/share/applications'),
    '/usr/local/share/applications',
    '/usr/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
  ];
  const needle = name.toLowerCase();
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    // Exact id match first (org.gnome.Calculator.desktop for "gnome-calculator" won't hit,
    // but "nautilus.desktop" and "google-chrome.desktop" will).
    const exact = entries.find(f => f.toLowerCase() === `${needle}.desktop`);
    if (exact) return path.join(dir, exact);
    for (const file of entries) {
      if (!file.endsWith('.desktop')) continue;
      if (file.toLowerCase().includes(needle)) return path.join(dir, file);
    }
  }
  return null;
}

function launchDetached(cmd, args = []) {
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function openAppLinux(name) {
  // URLs and file paths go to the desktop's default handler.
  if (/^(https?|file|mailto):/i.test(name) || name.startsWith('/') || name.startsWith('~')) {
    launchDetached('xdg-open', [name.replace(/^~/, os.homedir())]);
    return { opened: name, via: 'xdg-open' };
  }

  const candidates = [name, ...(LINUX_APP_ALIASES[name.toLowerCase()] || [])];

  // 1. An executable on PATH is the most predictable route.
  for (const cand of candidates) {
    if (cand !== 'xdg-open-default-browser' && commandExists(cand)) {
      launchDetached(cand);
      return { opened: cand, via: 'exec' };
    }
  }

  // 2. Otherwise look for a matching .desktop entry (covers Flatpaks and
  //    apps whose binary name differs from their display name).
  for (const cand of candidates) {
    const entry = findDesktopEntry(cand);
    if (entry) {
      launchDetached('gio', ['launch', entry]);
      return { opened: cand, via: `desktop-entry:${path.basename(entry)}` };
    }
  }

  // 3. "browser" with nothing better — hand the default browser a blank page.
  if (candidates.includes('xdg-open-default-browser')) {
    launchDetached('xdg-open', ['about:blank']);
    return { opened: 'default browser', via: 'xdg-open' };
  }

  throw new Error(`app_open: no executable or .desktop entry found for "${name}"`);
}

/** Open an application by name. */
async function openApp(target) {
  const name = (target || '').trim();
  if (!name) throw new Error('app_open: no target');
  let result;
  if (IS_WIN) {
    spawn('cmd.exe', ['/c', 'start', '', name], { detached: true, stdio: 'ignore', shell: false }).unref();
    result = { opened: name };
  } else {
    result = openAppLinux(name);
  }
  await new Promise(r => setTimeout(r, 1500));
  return result;
}

// ── Input automation ────────────────────────────────────────────────────────

/**
 * ydotool talks to a uinput device through ydotoold, so it works on Wayland
 * where xdotool only reaches XWayland clients. Setup is a one-time udev reload
 * plus `systemctl --user enable --now ydotool.service` (docs/06-SETUP-GUIDE.md §9).
 */
function ydotool(args) {
  try {
    return execFileSync('ydotool', args, {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, YDOTOOL_SOCKET: process.env.YDOTOOL_SOCKET || `${process.env.XDG_RUNTIME_DIR || '/run/user/' + process.getuid()}/.ydotool_socket` },
    });
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    if (/ENOENT|not found/i.test(detail)) {
      throw new Error('ydotool is not installed — desktop input needs it on Wayland (pacman -S ydotool)');
    }
    throw new Error(`ydotool ${args[0]} failed: ${detail} — is ydotoold running? (systemctl --user status ydotool)`);
  }
}

/** Click at absolute screen coordinates. */
async function desktopClick(x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (IS_WIN) {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
[M]::SetCursorPos(${cx}, ${cy})
Start-Sleep -Milliseconds 120
[M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
[M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
"clicked"
`;
    execSync('powershell -NoProfile -NonInteractive -Command -', { input: script, encoding: 'utf8' });
  } else {
    ydotool(['mousemove', '--absolute', '-x', String(cx), '-y', String(cy)]);
    await new Promise(r => setTimeout(r, 120));
    ydotool(['click', '0xC0']); // 0x40 left | 0x80 release => press+release
  }
  return { clicked: { x: cx, y: cy } };
}

// SendKeys-style tokens the planner emits, mapped to Linux input-event keycodes
// (linux/input-event-codes.h) for `ydotool key`.
const KEY_TOKENS = {
  ENTER: 28, TAB: 15, ESC: 1, ESCAPE: 1, BACKSPACE: 14, BS: 14, DEL: 111, DELETE: 111,
  HOME: 102, END: 107, PGUP: 104, PGDN: 109, UP: 103, DOWN: 108, LEFT: 105, RIGHT: 106,
  SPACE: 57,
};

/** Type text into the focused window. Supports {ENTER}, {TAB}, … tokens. */
async function desktopType(text) {
  const raw = String(text || '');
  if (IS_WIN) {
    const escaped = raw
      .replace(/'/g, "''")
      .replace(/\{|\}/g, m => ({ '{': '{{}', '}': '{}}' }[m]));
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
"typed"
`;
    execSync('powershell -NoProfile -NonInteractive -Command -', { input: script, encoding: 'utf8' });
    return { typed: text };
  }

  // Split on {TOKEN} so literal runs go through `ydotool type` and recognised
  // tokens become discrete key events.
  for (const part of raw.split(/(\{[A-Za-z]+\})/).filter(Boolean)) {
    const token = part.match(/^\{([A-Za-z]+)\}$/);
    const code = token && KEY_TOKENS[token[1].toUpperCase()];
    if (code) {
      ydotool(['key', `${code}:1`, `${code}:0`]);
    } else {
      ydotool(['type', '--key-delay', '12', '--', part]);
    }
  }
  return { typed: text };
}

// ── Files ───────────────────────────────────────────────────────────────────

/** Create a file with content (reversible tier). */
async function createFile(filePath, content = '') {
  const resolved = resolveSafePath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');
  return { created: resolved };
}

/** Delete a file/folder (ALWAYS irreversible tier — enforced by classifier). */
async function deleteFile(filePath) {
  const resolved = resolveSafePath(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`not found: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) fs.rmSync(resolved, { recursive: true, force: true });
  else fs.rmSync(resolved, { force: true });
  return { deleted: resolved };
}

/**
 * Sandboxed path resolution — the model sometimes hallucinates user dirs
 * (e.g. C:\Users\Alice\... from memory prefs, or /home/alice/... now that the
 * same memories are being read on Linux). Re-anchor any path that references a
 * different user's home to THIS machine's real homedir, preserving
 * Desktop/Documents subfolders and the filename.
 */
function resolveSafePath(filePath) {
  const realHome = os.homedir();
  const realUser = path.basename(realHome).toLowerCase();
  let p = String(filePath || '').trim();
  if (p.startsWith('~')) return path.join(realHome, p.slice(1));

  // Windows-style profile roots survive in stored memories even on Linux, so
  // check for them before path.resolve() mangles the backslashes.
  const win = p.match(/^[A-Za-z]:[\\/]Users[\\/]([^\\/]+)[\\/](.*)$/i);
  if (win) {
    const tail = win[2].replace(/\\/g, path.sep) || path.basename(p);
    if (win[1].toLowerCase() !== realUser) {
      const anchored = path.join(realHome, tail);
      console.log(`[DESKTOP] Path re-anchored: ${p} -> ${anchored}`);
      return anchored;
    }
    return path.join(realHome, tail);
  }

  const abs = path.resolve(p);
  const nix = abs.match(/^\/(?:home|Users)\/([^/]+)\/(.*)$/);
  if (nix && nix[1].toLowerCase() !== realUser) {
    const tail = nix[2] || path.basename(abs);
    const anchored = path.join(realHome, tail);
    console.log(`[DESKTOP] Path re-anchored: ${abs} -> ${anchored}`);
    return anchored;
  }
  return abs;
}

module.exports = { takeScreenshot, readScreen, openApp, desktopClick, desktopType, createFile, deleteFile };
