import { useEffect, useRef } from 'react';

const STATES = {
  idle: {
    color: 'bg-green-dim',
    shadow: 'shadow-[0_0_20px_rgba(31,158,104,0.3)]',
    animation: 'animate-pulse-slow',
    label: 'Idle',
  },
  woken: {
    color: 'bg-green-primary',
    shadow: 'shadow-[0_0_40px_rgba(51,255,164,0.6)]',
    animation: 'animate-pulse-fast',
    label: 'Listening',
  },
  processing: {
    color: 'bg-green-primary',
    shadow: 'shadow-[0_0_30px_rgba(51,255,164,0.4)]',
    animation: 'animate-spin-slow',
    label: 'Processing',
  },
  awaiting_approval: {
    color: 'bg-amber-approval',
    shadow: 'shadow-[0_0_35px_rgba(232,179,57,0.5)]',
    animation: '',
    label: 'Awaiting Approval',
  },
  executing: {
    color: 'bg-green-primary',
    shadow: 'shadow-[0_0_45px_rgba(51,255,164,0.7)]',
    animation: 'animate-pulse-fast',
    label: 'Executing',
  },
  response: {
    color: 'bg-green-dim',
    shadow: 'shadow-[0_0_25px_rgba(31,158,104,0.4)]',
    animation: 'animate-fade',
    label: 'Speaking',
  },
};

export default function ListeningOrb({ state = 'idle' }) {
  const s = STATES[state] || STATES.idle;
  const ref = useRef(null);

  useEffect(() => {
    if (state === 'processing' && ref.current) {
      ref.current.style.setProperty('--angle', '0deg');
      let raf;
      const spin = () => {
        const angle = (parseFloat(ref.current.style.getPropertyValue('--angle')) || 0) + 0.8;
        ref.current.style.setProperty('--angle', `${angle}deg`);
        ref.current.style.background = `conic-gradient(from var(--angle), #33FFA4 0%, #1f9e68 40%, #26382e 70%, #33FFA4 100%)`;
        raf = requestAnimationFrame(spin);
      };
      spin();
      return () => cancelAnimationFrame(raf);
    }
  }, [state]);

  const baseClass = `
    w-12 h-12 rounded-full transition-all duration-300 ease-in-out
    ${s.color} ${s.shadow}
    ${state === 'idle' ? 'animate-[pulse_4s_ease-in-out_infinite]' : ''}
    ${state === 'woken' || state === 'executing' ? 'animate-[pulse_1.5s_ease-in-out_infinite]' : ''}
    ${state === 'response' ? 'animate-[fadeIn_0.5s_ease-in-out]' : ''}
  `;

  return (
    <div className="flex items-center gap-3">
      <div ref={ref} className={baseClass} />
      <span className="text-xs text-text-secondary font-mono">{s.label}</span>
    </div>
  );
}
