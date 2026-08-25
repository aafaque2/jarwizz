import { useEffect, useRef } from 'react';

const COLORS = {
  idle: { main: '#14B854', glow: '20,184,84', intensity: 0.45 },
  listening: { main: '#00FF66', glow: '0,255,102', intensity: 1 },
  processing: { main: '#00FF66', glow: '0,255,102', intensity: 0.9 },
  speaking: { main: '#00FF66', glow: '0,255,102', intensity: 0.9 },
  'awaiting-approval': { main: '#FF7A18', glow: '255,122,24', intensity: 0.8 },
  error: { main: '#E85B4E', glow: '232,91,78', intensity: 1 },
};

const AROUSAL = {
  idle: 0.35,
  listening: 1,
  processing: 1.2,
  speaking: 0.9,
  'awaiting-approval': 0.6,
  error: 1,
};

function normalizeState(raw) {
  switch (raw) {
    case 'executing':
      return 'processing';
    case 'response':
      return 'speaking';
    case 'awaiting_approval':
      return 'awaiting-approval';
    default:
      return raw || 'idle';
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export default function OrbCore({ state = 'idle', mode = 'docked', dockPoint, audioRef }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const modeRef = useRef(mode);
  const dockRef = useRef(dockPoint);
  const audioRef2 = useRef(audioRef);
  stateRef.current = state;
  modeRef.current = mode;
  dockRef.current = dockPoint;
  audioRef2.current = audioRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let w = 0;
    let h = 0;

    const anim = { r: 40, cx: 90, cy: window.innerHeight - 100, alpha: 0.55 };
    const smoothSpectrum = new Float32Array(64);
    let smoothLevel = 0;
    let sweepAngle = 0;
    let errorFlash = 0;
    let prevColorKey = 'idle';
    let colorBlend = 1;

    const motes = Array.from({ length: 10 }, (_, i) => ({
      phase: (i / 10) * Math.PI * 2,
      speed: 0.25 + Math.random() * 0.5,
      tilt: Math.random() * Math.PI,
      dist: 1.45 + Math.random() * 0.55,
      size: 1 + Math.random() * 1.6,
    }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const targets = () => {
      const m = modeRef.current;
      const d = dockRef.current || { x: 90, y: window.innerHeight - 100 };
      if (m === 'center') {
        return { r: Math.min(w, h) * 0.21, cx: w / 2, cy: h / 2, alpha: 1 };
      }
      return { r: 42, cx: d.x, cy: d.y, alpha: stateRef.current === 'idle' ? 0.55 : 1 };
    };

    const drawAtmosphere = (cx, cy, r, col, breath) => {
      const g = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.3);
      g.addColorStop(0, `rgba(${col.glow},${0.28 * breath * col.intensity})`);
      g.addColorStop(0.55, `rgba(${col.glow},${0.08 * breath * col.intensity})`);
      g.addColorStop(1, `rgba(${col.glow},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.3, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawCore = (cx, cy, r, col, breath, level) => {
      const coreR = r * (0.62 + 0.05 * breath + 0.06 * level);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.5);
      const g = ctx.createRadialGradient(-coreR * 0.3, -coreR * 0.35, coreR * 0.05, 0, 0, coreR);
      g.addColorStop(0, `rgba(255,255,255,${0.85 * col.intensity})`);
      g.addColorStop(0.25, col.main);
      g.addColorStop(0.8, `rgba(${col.glow},0.35)`);
      g.addColorStop(1, `rgba(${col.glow},0.05)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255,255,255,${0.18 * col.intensity})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-coreR * 0.28, -coreR * 0.32, coreR * 0.42, Math.PI * 1.1, Math.PI * 1.75);
      ctx.stroke();
      ctx.restore();
    };

    const drawArcs = (cx, cy, r, t, arousal, col) => {
      const arcs = [
        { rad: 1.02, dash: [r * 0.5, r * 0.22], speed: 0.5, width: 2 },
        { rad: 1.12, dash: [r * 0.16, r * 0.1], speed: -0.32, width: 1.4 },
        { rad: 1.2, dash: [r * 0.34, r * 0.48], speed: 0.18, width: 1 },
      ];
      for (const a of arcs) {
        const radius = r * a.rad * (1.04 - 0.04 * arousal);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * a.speed * (0.4 + arousal));
        ctx.setLineDash(a.dash);
        ctx.strokeStyle = `rgba(${col.glow},${0.25 + 0.35 * arousal})`;
        ctx.lineWidth = a.width;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);
    };

    const binValue = (i, n, t, live, spectrum, level) => {
      if (live && spectrum) return spectrum[i] / 255;
      const p = (i / n) * Math.PI * 2;
      const base = 0.12 + 0.4 * level;
      return (
        base +
        base * 0.8 * Math.sin(t * 6.5 + p * 3) +
        base * 0.55 * Math.sin(t * 11.3 - p * 5 + 1.7)
      );
    };

    const drawWaveRing = (cx, cy, r, t, col, spectrum, level, live) => {
      const n = 64;
      const base = r * 1.32;
      const ampMax = r * 0.34;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const idx = i % n;
        const target = binValue(idx, n, t, live, spectrum, level);
        smoothSpectrum[idx] = lerp(smoothSpectrum[idx], target, 0.35);
        const v = smoothSpectrum[idx];
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const rad = base + v * ampMax * (0.4 + 0.6 * col.intensity);
        const x = cx + Math.cos(angle) * rad;
        const y = cy + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(cx, cy, base * 0.7, cx, cy, base + ampMax);
      g.addColorStop(0, `rgba(${col.glow},0.05)`);
      g.addColorStop(1, `rgba(${col.glow},0.22)`);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = `rgba(${col.main},${0.5 + 0.3 * col.intensity})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    };

    const drawMotes = (cx, cy, r, t, arousal, col) => {
      for (const m of motes) {
        const a = t * m.speed * (0.5 + arousal) + m.phase;
        const x = cx + Math.cos(a) * r * m.dist;
        const y = cy + Math.sin(a) * r * m.dist * Math.cos(m.tilt) * 0.5;
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + m.phase * 3));
        ctx.fillStyle = `rgba(${col.glow},${0.5 * twinkle})`;
        ctx.beginPath();
        ctx.arc(x, y, m.size, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawOverlays = (cx, cy, r, dt, t, st, col) => {
      if (st === 'processing') {
        sweepAngle += dt * 3.2;
        const radius = r * 0.86;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(sweepAngle);
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * col.intensity})`;
        ctx.lineWidth = r * 0.07;
        ctx.lineCap = 'round';
        ctx.shadowColor = col.main;
        ctx.shadowBlur = r * 0.25;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 0.55);
        ctx.stroke();
        ctx.restore();
      }
      if (st === 'awaiting-approval') {
        const pulse = 0.6 + 0.4 * Math.sin(t * 2.4);
        ctx.strokeStyle = `rgba(255,122,24,${pulse})`;
        ctx.lineWidth = 2.4;
        ctx.shadowColor = '#FF7A18';
        ctx.shadowBlur = r * 0.3 * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.09, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (st === 'error') {
        errorFlash = 1;
      }
      if (errorFlash > 0) {
        errorFlash = Math.max(0, errorFlash - dt * 1.8);
        ctx.strokeStyle = `rgba(232,91,78,${errorFlash})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const st = normalizeState(stateRef.current);
      const active = st !== 'idle';
      const fpsCap = active ? 60 : 30;
      acc += dt;
      if (acc < 1 / fpsCap) return;
      const step = acc;
      acc = 0;
      const tSec = now / 1000;

      const tg = targets();
      const ease = 1 - Math.pow(0.001, step);
      anim.r = lerp(anim.r, tg.r, ease);
      anim.cx = lerp(anim.cx, tg.cx, ease);
      anim.cy = lerp(anim.cy, tg.cy, ease);
      anim.alpha = lerp(anim.alpha, tg.alpha, ease);

      const audio = audioRef2.current;
      let spectrum = null;
      let level = 0;
      let live = false;
      if (audio && (st === 'listening' || st === 'speaking')) {
        const s = audio.sample();
        spectrum = s.spectrum;
        level = s.level;
        live = audio.isLive();
      } else if (audio && audio.isLive() && st !== 'idle') {
        const s = audio.sample();
        level = s.level;
        live = true;
      }
      if (st === 'speaking') {
        const pseudo =
          0.32 + 0.2 * Math.sin(tSec * 11) + 0.14 * Math.sin(tSec * 27 + 1.3);
        level = Math.max(level, Math.max(0, pseudo));
      }
      smoothLevel = lerp(smoothLevel, level, 0.3);

      const col = COLORS[st] || COLORS.idle;
      if (st !== prevColorKey) {
        prevColorKey = st;
        colorBlend = 0;
      }
      colorBlend = Math.min(1, colorBlend + step * 3);

      const arousal = AROUSAL[st] ?? 0.5;
      const breathT =
        st === 'idle' ? now / 1000 * (Math.PI * 2 / 4) : now / 1000 * (Math.PI * 2 / 1.8);
      const breath = 0.5 + 0.5 * Math.sin(breathT);

      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = anim.alpha;

      drawAtmosphere(anim.cx, anim.cy, anim.r, col, 0.6 + 0.4 * breath + smoothLevel * 0.5);
      drawWaveRing(anim.cx, anim.cy, anim.r, now / 1000, col, spectrum, smoothLevel, live);
      drawCore(anim.cx, anim.cy, anim.r, col, breath, smoothLevel);
      drawArcs(anim.cx, anim.cy, anim.r, now / 1000, arousal, col);
      if (modeRef.current === 'center' || active) {
        drawMotes(anim.cx, anim.cy, anim.r, now / 1000, arousal, col);
      }
      drawOverlays(anim.cx, anim.cy, anim.r, step, now / 1000, st, col);

      ctx.globalAlpha = 1;
      void colorBlend;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', display: 'block' }}
    />
  );
}
