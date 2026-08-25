import { spawn } from 'node:child_process';

const URL = 'http://localhost:5173';
const children = [];

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

function cleanup() {
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

const vite = spawn('npm', ['run', 'dev'], { shell: true, stdio: 'inherit' });
children.push(vite);

const ok = await waitForServer(URL);
if (!ok) {
  console.error('Vite dev server did not start in time');
  cleanup();
  process.exit(1);
}

const electron = spawn('electron', ['.'], {
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RENDERER_URL: URL },
});
children.push(electron);

electron.on('exit', () => {
  cleanup();
  process.exit(0);
});
