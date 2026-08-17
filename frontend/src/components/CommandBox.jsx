import { useState } from 'react';

export default function CommandBox({ onCommand }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cmd = text.trim();
    if (!cmd || sending) return;
    setSending(true);
    setText('');
    try {
      await onCommand(cmd);
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Say "Jarwizz, wake up" or type a command...'
          disabled={sending}
          className="
            w-full bg-bg-input border border-border-subtle rounded-lg
            px-4 py-3 font-mono text-sm text-text-primary
            placeholder:text-text-disabled
            focus:outline-none focus:border-green-primary focus:shadow-[0_0_15px_rgba(51,255,164,0.15)]
            transition-all duration-200
            disabled:opacity-50
          "
        />
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
    </form>
  );
}
