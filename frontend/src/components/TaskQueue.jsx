const TIER_COLORS = {
  'read-only': 'border-l-blue-info bg-blue-info/5',
  reversible: 'border-l-green-primary bg-green-primary/5',
  irreversible: 'border-l-amber-approval bg-amber-approval/5',
};

const STATUS_BADGES = {
  completed: 'bg-green-primary/15 text-green-primary',
  error: 'bg-red-error/15 text-red-error',
  rejected: 'bg-red-error/15 text-red-error',
  skipped: 'bg-text-disabled/15 text-text-disabled',
  pending: 'bg-amber-approval/15 text-amber-approval',
};

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

export default function TaskQueue({ tasks }) {
  if (!tasks.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-disabled">
        <div className="text-4xl opacity-30">🎙️</div>
        <div className="text-sm font-mono text-center">
          No tasks yet. Send a command to get started.
        </div>
        <div className="text-[10px] font-mono text-center text-text-disabled/60 max-w-xs">
          Try: "hello" · "what is 2+2?" · "search for AI news" · "read my last 5 emails"
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-1">
      {tasks.map((task) => (
        <TaskCard key={task.task_id} task={task} />
      ))}
    </div>
  );
}

function TaskCard({ task }) {
  const isConversational = task.isConversational;
  const completedSteps = (task.steps || []).filter(s => s.status === 'completed').length;
  const totalSteps = task.totalSteps || task.steps?.length || 0;

  return (
    <div className="bg-bg-panel rounded-lg border border-border-subtle overflow-hidden">
      {/* Task header */}
      <div className="px-3 py-2 border-b border-border-subtle/50 flex items-center justify-between">
        <span className="text-xs font-mono text-text-secondary truncate max-w-[70%]">
          {task.command || 'Task'}
        </span>
        {!isConversational && totalSteps > 0 && (
          <span className="text-[10px] font-mono text-text-disabled">
            {completedSteps}/{totalSteps}
          </span>
        )}
      </div>

      {/* Steps */}
      <div className="p-2">
        {(task.steps || []).map((step, i) => (
          <StepRow key={step.step_id || i} step={step} isConversational={isConversational} />
        ))}
        {task.steps?.length === 0 && (
          <div className="flex items-center gap-2 py-2 px-2">
            <div className="w-3 h-3 rounded-full border-2 border-green-primary/40 border-t-green-primary animate-spin" />
            <span className="text-xs text-text-disabled font-mono">Processing...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StepRow({ step, isConversational }) {
  const tierClass = TIER_COLORS[step.tier] || 'border-l-text-disabled';
  const badgeClass = STATUS_BADGES[step.status] || 'bg-text-disabled/15 text-text-disabled';
  const icon = ACTION_ICONS[step.action_type] || '⚡';
  const replyText = step.output?.text;
  const screenshot = step.screenshot_after;

  // Conversational reply or LLM answer — show the response prominently, hide planning text
  if (step.isReply || isConversational || (step.action_type === 'answer_question' && replyText)) {
    return (
      <div className="py-2 px-2">
        <div className="bg-green-primary/5 border border-green-primary/20 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <span className="text-lg shrink-0">💬</span>
            <div className="flex-1">
              <p className="text-sm text-text-primary leading-relaxed">
                {replyText || step.description}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] font-mono text-green-primary/60">Jarwizz</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`border-l-2 ${tierClass} pl-3 py-2 flex flex-col gap-1`}>
      {/* Main row */}
      <div className="flex items-center gap-2">
        <span className="text-sm shrink-0">{icon}</span>
        <span className="text-xs font-mono text-text-primary truncate flex-1">
          {step.description || step.action_type}
        </span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badgeClass}`}>
          {step.status === 'completed' ? '✓' : step.status === 'error' ? '✗' : step.status === 'pending' ? '⏳' : step.status}
        </span>
      </div>

      {/* Error message */}
      {step.error && (
        <div className="ml-6 text-[10px] text-red-error/80 font-mono truncate">
          {step.error}
        </div>
      )}

      {/* Screenshot thumbnail */}
      {screenshot && (
        <div className="ml-6 mt-1">
          <img
            src={`/screenshots/${screenshot.split('\\').pop()}`}
            alt="browser state"
            className="max-h-20 rounded border border-border-subtle/50 object-cover"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        </div>
      )}
    </div>
  );
}
