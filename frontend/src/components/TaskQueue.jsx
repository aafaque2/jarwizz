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
};

export default function TaskQueue({ tasks }) {
  if (!tasks.length) {
    return (
      <div className="text-text-disabled text-sm font-mono p-4 text-center">
        No tasks yet. Send a command to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-full p-1">
      {tasks.map((task) => (
        <div key={task.task_id || task.step_id} className="flex flex-col gap-1">
          {task.steps ? (
            // Task group with sub-steps
            <div className="bg-bg-panel rounded-lg border border-border-subtle p-3">
              <div className="text-xs text-text-secondary font-mono mb-2 truncate">
                {task.command || 'Task'}
              </div>
              {task.steps.map((step, i) => (
                <StepRow key={step.step_id || i} step={step} />
              ))}
            </div>
          ) : (
            // Single step event
            <StepRow step={task} />
          )}
        </div>
      ))}
    </div>
  );
}

function StepRow({ step }) {
  const tierClass = TIER_COLORS[step.tier] || 'border-l-text-disabled';
  const badgeClass = STATUS_BADGES[step.status] || 'bg-text-disabled/15 text-text-disabled';

  return (
    <div className={`border-l-2 ${tierClass} pl-3 py-1.5 flex items-center gap-2`}>
      <span className="text-xs font-mono text-text-primary truncate flex-1">
        {step.description || step.action_type}
      </span>
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badgeClass}`}>
        {step.status || 'pending'}
      </span>
    </div>
  );
}
