import { useState, useEffect } from 'react';

const TIER_BORDER = {
  'read-only': 'border-l-blue-info',
  reversible: 'border-l-green-primary',
  irreversible: 'border-l-amber-approval',
};

const STATUS_COLOR = {
  success: 'text-green-primary',
  failure: 'text-red-error',
};

export default function LogViewer() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/logs');
      const data = await res.json();
      setLogs(data.reverse());
    } catch {}
  };

  const filtered = logs.filter((l) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      l.description?.toLowerCase().includes(f) ||
      l.action_type?.toLowerCase().includes(f) ||
      l.tier?.toLowerCase().includes(f) ||
      l.result?.toLowerCase().includes(f)
    );
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter logs..."
          className="
            flex-1 bg-bg-input border border-border-subtle rounded
            px-2 py-1 text-xs font-mono text-text-primary
            placeholder:text-text-disabled
            focus:outline-none focus:border-green-primary
          "
        />
        <button
          onClick={fetchLogs}
          className="text-xs text-text-secondary hover:text-green-primary transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {filtered.length === 0 && (
          <div className="text-text-disabled text-xs font-mono text-center py-4">
            {logs.length === 0 ? 'No log entries yet.' : 'No matches for filter.'}
          </div>
        )}
        {filtered.map((log, i) => {
          const tierBorder = TIER_BORDER[log.tier] || 'border-l-text-disabled';
          const isOpen = expanded === i;

          return (
            <div
              key={log.step_id || i}
              className={`border-l-2 ${tierBorder} bg-bg-panel rounded-r-lg cursor-pointer hover:bg-bg-panel-raised transition-colors`}
              onClick={() => setExpanded(isOpen ? null : i)}
            >
              <div className="px-3 py-2 flex items-center gap-2">
                <span className="text-[10px] font-mono text-text-disabled w-36 shrink-0">
                  {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '--:--'}
                </span>
                <span className="text-[10px] font-mono text-text-secondary shrink-0 w-20">
                  {log.action_type}
                </span>
                <span className="text-xs text-text-primary truncate flex-1">
                  {log.description}
                </span>
                <span className={`text-[10px] font-mono ${STATUS_COLOR[log.result] || 'text-text-disabled'}`}>
                  {log.result}
                </span>
                {log.approval_status !== 'auto' && (
                  <span className="text-[10px] font-mono text-amber-approval">
                    {log.approval_status}
                  </span>
                )}
              </div>

              {/* Expanded details */}
              {isOpen && (
                <div className="px-3 pb-3 border-t border-border-subtle mt-1 pt-2">
                  <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap break-all mb-2">
                    {JSON.stringify(log, null, 2)}
                  </pre>
                  {log.screenshot_before && (
                    <div className="flex gap-2">
                      <div>
                        <div className="text-[10px] text-text-disabled mb-1">Before:</div>
                        <img src={`/screenshots/${log.screenshot_before.split('\\').pop()}`} alt="before" className="max-w-[200px] rounded border border-border-subtle" />
                      </div>
                      {log.screenshot_after && (
                        <div>
                          <div className="text-[10px] text-text-disabled mb-1">After:</div>
                          <img src={`/screenshots/${log.screenshot_after.split('\\').pop()}`} alt="after" className="max-w-[200px] rounded border border-border-subtle" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
