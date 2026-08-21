import { useRef, useEffect } from 'react';

const ACTION_ICONS = {
  answer_question: '💬',
  gmail_read: '📧',
  gmail_draft: '✉️',
  gmail_send: '📤',
  browser_open: '🌐',
  browser_click: '🖱️',
  browser_type: '⌨️',
  browser_scroll: '📜',
  browser_read: '📖',
  summarize: '📋',
};

export default function ChatView({ chat, currentTask }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages?.length, currentTask]);

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-disabled gap-3">
        <div className="text-4xl opacity-30">🎙️</div>
        <div className="text-sm font-mono text-center">Select or start a new chat</div>
        <div className="text-[10px] font-mono text-center text-text-disabled/60 max-w-xs">
          Conversations are saved so the AI remembers context
        </div>
      </div>
    );
  }

  const messages = chat.messages || [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !currentTask && (
          <div className="flex flex-col items-center justify-center h-full text-text-disabled gap-3">
            <div className="text-4xl opacity-30">💬</div>
            <div className="text-sm font-mono text-center">Send a message to start</div>
          </div>
        )}

        <div className="flex flex-col gap-4 max-w-3xl mx-auto">
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Currently executing task (live updates) */}
          {currentTask && <LiveTask task={currentTask} />}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
        isUser
          ? 'bg-green-primary/15 text-text-primary border border-green-primary/20'
          : 'bg-bg-panel text-text-primary border border-border-subtle'
      }`}>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className={`text-[10px] font-mono ${isUser ? 'text-green-primary/60' : 'text-text-disabled'}`}>
            {isUser ? 'You' : 'Jarwizz'}
          </span>
        </div>
      </div>
    </div>
  );
}

function LiveTask({ task }) {
  if (!task?.steps?.length && !task?.command) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-xl px-4 py-3 bg-bg-panel border border-border-subtle">
        {/* Command echo */}
        {task.command && (
          <div className="text-xs font-mono text-text-secondary mb-2">
            {task.command}
          </div>
        )}

        {/* Steps */}
        <div className="flex flex-col gap-1.5">
          {task.steps?.map((step, i) => (
            <div key={`${step.step_id || 'step'}-${i}`} className="flex items-center gap-2">
              <span className="text-xs">{ACTION_ICONS[step.action_type] || '⚡'}</span>
              <span className="text-xs font-mono text-text-primary truncate flex-1">
                {step.description || step.action_type}
              </span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                step.status === 'completed' ? 'bg-green-primary/15 text-green-primary'
                : step.status === 'error' ? 'bg-red-error/15 text-red-error'
                : 'bg-amber-approval/15 text-amber-approval'
              }`}>
                {step.status === 'completed' ? '✓' : step.status === 'error' ? '✗' : '⏳'}
              </span>
            </div>
          ))}
          {task.steps?.length === 0 && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-green-primary/40 border-t-green-primary animate-spin" />
              <span className="text-xs text-text-disabled font-mono">Processing...</span>
            </div>
          )}
        </div>

        {/* Error display */}
        {task.steps?.some(s => s.error) && (
          <div className="mt-2 text-[10px] text-red-error/80 font-mono">
            {task.steps.find(s => s.error)?.error}
          </div>
        )}
      </div>
    </div>
  );
}
