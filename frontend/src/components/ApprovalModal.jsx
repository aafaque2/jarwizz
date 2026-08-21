import { useState, useEffect, useRef, useCallback } from 'react';

export default function ApprovalModal({ approval, onApprove, onReject }) {
  const [deciding, setDeciding] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
    }
  }, []);

  // Auto-start listening when approval appears
  useEffect(() => {
    if (approval && speechSupported) {
      startListening();
    }
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [approval, speechSupported]);

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // Stop any existing recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript.toLowerCase().trim();
        if (event.results[i].isFinal) {
          finalText += t;
        } else {
          interimText += t;
        }
      }

      const combined = (finalText || interimText);
      setTranscript(combined);

      // Check for yes/no keywords
      if (combined.match(/\b(yes|yeah|yep|confirm|approve|go ahead|do it|accept)\b/)) {
        handleApprove();
      } else if (combined.match(/\b(no|nope|nah|reject|cancel|stop|deny)\b/)) {
        handleReject();
      }
    };

    recognition.onend = () => {
      setListening(false);
      // Restart if still awaiting approval and not deciding
      if (approval && !deciding) {
        setTimeout(() => {
          if (approval && !deciding) startListening();
        }, 500);
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[APPROVAL STT] Error:', event.error);
      }
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    setTranscript('');
    try { recognition.start(); } catch {}
  }, [approval, deciding]);

  const handleApprove = useCallback(async () => {
    if (deciding) return;
    setDeciding(true);
    setListening(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      await onApprove(approval.step_id);
    } finally {
      setDeciding(false);
    }
  }, [approval, onApprove, deciding]);

  const handleReject = useCallback(async () => {
    if (deciding) return;
    setDeciding(true);
    setListening(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      await onReject(approval.step_id);
    } finally {
      setDeciding(false);
    }
  }, [approval, onReject, deciding]);

  if (!approval) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />

      {/* Modal */}
      <div className="
        relative bg-bg-panel border-2 border-amber-approval rounded-xl
        shadow-[0_0_60px_rgba(232,179,57,0.2)]
        max-w-md w-full mx-4 p-6
      " style={{ animation: 'fadeIn 0.2s ease-out' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-3 h-3 rounded-full bg-amber-approval animate-[pulse_2s_ease-in-out_infinite]" />
          <h2 className="text-lg font-semibold text-amber-approval">
            Approval Required
          </h2>
        </div>

        {/* Description */}
        <p className="text-text-primary text-sm mb-4">
          {approval.description}
        </p>

        {/* Details */}
        <div className="bg-bg-input rounded-lg p-3 mb-4 font-mono text-xs text-text-secondary">
          <div className="flex justify-between mb-1">
            <span>Action:</span>
            <span className="text-text-primary">{approval.action_type}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>Tier:</span>
            <span className="text-amber-approval">{approval.tier}</span>
          </div>
          {approval.payload && Object.keys(approval.payload).length > 0 && (
            <div className="mt-2 border-t border-border-subtle pt-2">
              <div className="text-text-disabled mb-1">Payload:</div>
              <pre className="text-text-primary whitespace-pre-wrap break-all">
                {JSON.stringify(approval.payload, null, 2)}
              </pre>
            </div>
          )}
          {approval.whitelist_override && (
            <div className="mt-2 text-amber-approval text-[10px]">
              * Domain not whitelisted — forced to irreversible tier
            </div>
          )}
        </div>

        {/* Voice listening status */}
        {speechSupported && (
          <div className="mb-4 flex flex-col items-center gap-2">
            {listening && (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-amber-approval rounded-full animate-pulse"
                      style={{
                        height: `${6 + Math.random() * 10}px`,
                        animationDelay: `${i * 0.1}s`,
                        animationDuration: `${0.4 + Math.random() * 0.3}s`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-[10px] font-mono text-amber-approval/70">
                  Listening for "yes" or "no"...
                </span>
              </div>
            )}
            {transcript && (
              <div className="text-[10px] font-mono text-text-disabled italic">
                "{transcript}"
              </div>
            )}
            {!listening && !deciding && (
              <button
                onClick={startListening}
                className="text-[10px] font-mono text-amber-approval/50 hover:text-amber-approval transition-colors"
              >
                Tap to enable voice
              </button>
            )}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={deciding}
            className="
              flex-1 bg-green-primary hover:bg-green-primary/80
              text-bg-void font-semibold py-2.5 rounded-lg
              transition-all duration-200
              disabled:opacity-50
            "
          >
            {deciding ? '...' : 'Confirm (yes)'}
          </button>
          <button
            onClick={handleReject}
            disabled={deciding}
            className="
              flex-1 border border-red-error text-red-error
              hover:bg-red-error/10 font-semibold py-2.5 rounded-lg
              transition-all duration-200
              disabled:opacity-50
            "
          >
            {deciding ? '...' : 'Reject (no)'}
          </button>
        </div>
      </div>
    </div>
  );
}
