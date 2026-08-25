import { useEffect, useRef, useState } from 'react';
import OrbCore from '../components/orb/OrbCore';
import useAudioAnalyser from '../hooks/useAudioAnalyser';

const WS_URL = 'ws://localhost:4000/ws';
const DOCK_KEY = 'jarwizz-dock';

function loadDock() {
  try {
    const saved = JSON.parse(localStorage.getItem(DOCK_KEY) || 'null');
    if (saved && Number.isFinite(saved.x)) {
      return {
        x: Math.min(saved.x, window.innerWidth - 60),
        y: Math.min(saved.y, window.innerHeight - 60),
      };
    }
  } catch {}
  return { x: 90, y: window.innerHeight - 100 };
}

export default function OrbApp() {
  const [state, setState] = useState('idle');
  const [summoned, setSummoned] = useState(false);
  const [dockPoint, setDockPoint] = useState(loadDock);

  const stateRef = useRef('idle');
  const summonedRef = useRef(false);
  const hitRef = useRef(false);
  const pressRef = useRef(null);
  const clickTimerRef = useRef(null);

  const audio = useAudioAnalyser();
  stateRef.current = state;
  summonedRef.current = summoned;

  useEffect(() => {
    let reconnect;
    let responseTimer;
    let processingTimer;
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => {
        let event;
        try {
          ({ event } = JSON.parse(e.data));
        } catch {
          return;
        }
        clearTimeout(responseTimer);
        clearTimeout(processingTimer);
        switch (event) {
          case 'plan_created':
          case 'step_completed':
            setState('processing');
            break;
          case 'conversational_reply':
            setState('response');
            responseTimer = setTimeout(
              () => setState((s) => (s === 'response' ? 'idle' : s)),
              4000
            );
            break;
          case 'pending_approval':
            setState('awaiting_approval');
            break;
          case 'step_error':
            setState('error');
            processingTimer = setTimeout(
              () => setState((s) => (s === 'error' ? 'idle' : s)),
              2500
            );
            break;
          case 'stop':
          case 'plan_finished':
            setState('idle');
            break;
          default:
            break;
        }
      };
      ws.onclose = () => {
        reconnect = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      clearTimeout(reconnect);
      clearTimeout(responseTimer);
      clearTimeout(processingTimer);
    };
  }, []);

  useEffect(() => {
    const listener = () => {
      setSummoned((prev) => !prev);
    };
    window.jarwizz?.onSummonToggle(listener);
    return () => window.jarwizz?.offSummonToggle(listener);
  }, []);

  useEffect(() => {
    audio.attach();
  }, [audio]);

  useEffect(() => {
    if (summoned) {
      if (stateRef.current === 'idle') setState('listening');
    } else if (stateRef.current === 'listening') {
      setState('idle');
    }
  }, [summoned]);

  // Voice auto-summon: sustained mic energy while idle expands the orb
  // (wake-word stand-in until the wake word model is wired to the frontend).
  useEffect(() => {
    let raf = 0;
    let lastVoice = 0;
    let lastBusy = Date.now();
    const VOICE_THRESHOLD = 0.14;
    const SUSTAIN_MS = 350;
    const DISMISS_SILENCE_MS = 6000;
    const BUSY_COOLDOWN_MS = 2000;
    let voiceStart = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = Date.now();
      const st = stateRef.current;
      if (st !== 'idle') {
        lastBusy = now;
        voiceStart = 0;
        return;
      }
      if (now - lastBusy < BUSY_COOLDOWN_MS) return;
      const { level } = audio.sample();
      if (level > VOICE_THRESHOLD) {
        if (!voiceStart) voiceStart = now;
        if (now - voiceStart > SUSTAIN_MS) {
          lastVoice = now;
          if (!summonedRef.current) setSummoned(true);
        }
      } else if (
        summonedRef.current &&
        stateRef.current === 'listening' &&
        lastVoice &&
        now - lastVoice > DISMISS_SILENCE_MS
      ) {
        setSummoned(false);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audio]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && summonedRef.current) setSummoned(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const radius = () => (summoned ? Math.min(window.innerWidth, window.innerHeight) * 0.21 : 52);
    const onMove = (e) => {
      if (pressRef.current?.dragging) {
        pressRef.current.cx = e.clientX;
        pressRef.current.cy = e.clientY;
        window.jarwizz?.drag(e.clientX, e.clientY);
        return;
      }
      if (pressRef.current) {
        if (
          Math.hypot(e.clientX - pressRef.current.sx, e.clientY - pressRef.current.sy) > 6
        ) {
          pressRef.current.dragging = true;
          if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
          }
        }
        return;
      }
      if (e.buttons !== 0) return;
      const dx = e.clientX - dockPoint.x;
      const dy = e.clientY - dockPoint.y;
      const inside = dx * dx + dy * dy <= radius() * radius() * 1.3;
      if (inside !== hitRef.current) {
        hitRef.current = inside;
        window.jarwizz?.setHit(inside);
        document.body.style.cursor = inside ? 'grab' : 'default';
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [dockPoint, summoned]);

  useEffect(() => {
    const onDown = (e) => {
      if (e.button !== 0 || !hitRef.current || pressRef.current) return;
      pressRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        cx: e.clientX,
        cy: e.clientY,
        dragging: false,
      };
    };
    const onUp = () => {
      const p = pressRef.current;
      if (!p) return;
      pressRef.current = null;
      document.body.style.cursor = hitRef.current ? 'grab' : 'default';
      if (p.dragging) {
        setDockPoint({ x: p.cx, y: p.cy });
        localStorage.setItem(DOCK_KEY, JSON.stringify({ x: p.cx, y: p.cy }));
        window.jarwizz?.dockEnd();
        return;
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        window.jarwizz?.toggleDashboard();
        return;
      }
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        if (stateRef.current === 'awaiting_approval') return;
        setSummoned((prev) => !prev);
      }, 260);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <OrbCore
      state={summoned ? 'listening' : state}
      mode={summoned ? 'center' : 'docked'}
      dockPoint={dockPoint}
      audioRef={audio}
    />
  );
}
