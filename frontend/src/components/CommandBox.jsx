import { useState, useRef, useCallback, useEffect } from 'react';

export default function CommandBox({ onCommand }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  // Committed text (typed + finalized speech). Interim results are shown
  // on top of this but never committed — fixes "hellohello" duplication.
  const baseTextRef = useRef('');

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          baseTextRef.current = `${baseTextRef.current}${finalTranscript}`.replace(/\s+/g, ' ');
          setText(baseTextRef.current);
        } else if (interimTranscript) {
          // Preview only — do not write into baseTextRef
          setText(`${baseTextRef.current}${interimTranscript}`);
        }
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognition.onerror = (event) => {
        console.warn('[STT] Error:', event.error);
        setListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleMic = useCallback(() => {
    if (!recognitionRef.current) return;

    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      baseTextRef.current = inputRef.current?.value ?? '';
      setListening(true);
      try { recognitionRef.current.start(); } catch {}
    }
  }, [listening]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cmd = text.trim();
    if (!cmd || sending) return;
    setSending(true);
    setText('');
    baseTextRef.current = '';
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
    }
    try {
      await onCommand(cmd);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center gap-2">
        {/* Mic button */}
        {speechSupported && (
          <button
            type="button"
            onClick={toggleMic}
            className={`
              shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
              transition-all duration-200 border
              ${listening
                ? 'bg-red-error/20 border-red-error/50 text-red-error animate-[pulse_1.5s_ease-in-out_infinite]'
                : 'bg-bg-input border-border-subtle text-text-secondary hover:text-green-primary hover:border-green-primary/30'
              }
            `}
            title={listening ? 'Stop listening' : 'Start voice input'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>
        )}

        {/* Text input */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => { setText(e.target.value); baseTextRef.current = e.target.value; }}
            onKeyDown={handleKeyDown}
            placeholder={listening ? 'Listening...' : 'Type a command or press mic to speak...'}
            disabled={sending}
            className="
              w-full bg-bg-input border border-border-subtle rounded-lg
              pl-4 pr-20 py-3 font-mono text-sm text-text-primary
              placeholder:text-text-disabled
              focus:outline-none focus:border-green-primary focus:shadow-[0_0_15px_rgba(51,255,164,0.15)]
              transition-all duration-200
              disabled:opacity-50
            "
          />
          {/* Send button — inside the input, positioned at right */}
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="
              absolute right-2 top-1/2 -translate-y-1/2
              bg-green-primary/10 hover:bg-green-primary/20
              text-green-primary text-xs font-medium
              px-3 py-1.5 rounded-md
              transition-all duration-200
              disabled:opacity-30 disabled:cursor-not-allowed
            "
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Listening indicator */}
      {listening && (
        <div className="flex items-center gap-2 mt-2 px-1">
          <div className="flex gap-0.5">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-red-error rounded-full animate-pulse"
                style={{
                  height: `${8 + Math.random() * 12}px`,
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: `${0.4 + Math.random() * 0.3}s`,
                }}
              />
            ))}
          </div>
          <span className="text-[10px] font-mono text-red-error/70">Listening... speak now</span>
        </div>
      )}
    </form>
  );
}
