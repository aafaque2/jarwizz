/**
 * Phase 9 — Desktop control runner (v2).
 * Screenshot capture + input automation on Windows via PowerShell,
 * screen understanding via describeScreen() from the shared llama.cpp client
 * (single vision-capable model — no separate vision integration).
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let _describeScreen = null;
function getDescribeScreen() {
  if (!_describeScreen) {
    // Lazy require so this module can be loaded without the model server running
    ({ describeScreen } = require('../../model/llamacppClient'));
    _describeScreen = describeScreen;
  }
  return _describeScreen;
}

/** Capture the full virtual screen to a PNG Buffer via .NET CopyFromScreen. */
async function takeScreenshot() {
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
 * Vision-grounded screen reading — captures a screenshot and describes it via
 * the same Qwen3-VL model used for planning (describeScreen built in Phase 1).
 */
async function readScreen(prompt = "Describe what's visible on this screen in one paragraph — list windows, buttons, and any text you can read.") {
  const imageBuffer = await takeScreenshot();
  const describe = getDescribeScreen();
  const description = await describe(imageBuffer, prompt);
  return { description, screenshot_bytes: imageBuffer.length };
}

/** Open an application by name via shell:start (resolves PATH + App Paths). */
async function openApp(target) {
  const name = (target || '').trim();
  if (!name) throw new Error('app_open: no target');
  spawn('cmd.exe', ['/c', 'start', '', name], { detached: true, stdio: 'ignore', shell: false }).unref();
  await new Promise(r => setTimeout(r, 1500));
  return { opened: name };
}

/** Click at absolute screen coordinates (user32 SetCursorPos + mouse_event). */
async function desktopClick(x, y) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
[M]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
Start-Sleep -Milliseconds 120
[M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
[M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
"clicked"
`;
  execSync('powershell -NoProfile -NonInteractive -Command -', { input: script, encoding: 'utf8' });
  return { clicked: { x: Math.round(x), y: Math.round(y) } };
}

/** Type text into the focused window (SendKeys; supports {ENTER}, {TAB}). */
async function desktopType(text) {
  const escaped = String(text || '')
    .replace(/'/g, "''")
    .replace(/\{|\}/g, m => ({'{':'{{}','}':'{}}'}[m]));
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
"typed"
`;
  execSync('powershell -NoProfile -NonInteractive -Command -', { input: script, encoding: 'utf8' });
  return { typed: text };
}

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
 * (e.g. C:\Users\Alice\... from memory prefs). Re-anchor any path that
 * references a different user's profile to THIS machine's real homedir,
 * preserving Desktop/Documents subfolders and the filename.
 */
function resolveSafePath(filePath) {
  const realHome = os.homedir();
  let p = String(filePath || '').trim();
  if (p.startsWith('~')) return path.join(realHome, p.slice(1));
  const abs = path.resolve(p);
  // Detect foreign user-profile roots: C:\Users\<someone>\
  const m = abs.match(/^(?:[A-Za-z]:\\Users\\([^\\]+))\\(.*)$/i);
  if (m && m[1].toLowerCase() !== path.basename(realHome).toLowerCase()) {
    // Keep the meaningful tail (Desktop\file.txt etc.), drop the wrong user root
    const tail = m[2] || path.basename(abs);
    const anchored = path.join(realHome, tail);
    console.log(`[DESKTOP] Path re-anchored: ${abs} -> ${anchored}`);
    return anchored;
  }
  return abs;
}

module.exports = { takeScreenshot, readScreen, openApp, desktopClick, desktopType, createFile, deleteFile };
