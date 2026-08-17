import { useState } from 'react';

export default function ApprovalModal({ approval, onApprove, onReject }) {
  const [deciding, setDeciding] = useState(false);

  if (!approval) return null;

  const handleApprove = async () => {
    setDeciding(true);
    try {
      await onApprove(approval.step_id);
    } finally {
      setDeciding(false);
    }
  };

  const handleReject = async () => {
    setDeciding(true);
    try {
      await onReject(approval.step_id);
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="
        relative bg-bg-panel border-2 border-amber-approval rounded-xl
        shadow-[0_0_60px_rgba(232,179,57,0.2)]
        max-w-md w-full mx-4 p-6
      ">
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

        {/* Voice hint */}
        <div className="text-text-disabled text-xs font-mono text-center mb-4">
          Say "yes" to confirm or "no" to reject
        </div>

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
            {deciding ? '...' : 'Confirm'}
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
            {deciding ? '...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
