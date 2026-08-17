import { useState, useEffect, useRef, useCallback } from 'react';
import ListeningOrb from './components/ListeningOrb';
import CommandBox from './components/CommandBox';
import TaskQueue from './components/TaskQueue';
import ApprovalModal from './components/ApprovalModal';
import LogViewer from './components/LogViewer';

const API = '';
const WS_URL = `ws://${window.location.host}`;

export default function App() {
  const [orbState, setOrbState] = useState('idle');
  const [tasks, setTasks] = useState([]);
  const [approval, setApproval] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const wsRef = useRef(null);

  // WebSocket connection
  useEffect(() => {
    let reconnect;
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => console.log('[WS] connected');

      ws.onmessage = (e) => {
        const { event, data } = JSON.parse(e.data);

        switch (event) {
          case 'plan_created':
            setOrbState('processing');
            setTasks((prev) => [...prev, { task_id: data.plan?.steps?.[0]?.step_id, command: data.plan?._originalCommand || 'Task', steps: [] }]);
            break;

          case 'step_completed':
            setOrbState('executing');
            setTasks((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last) {
                last.steps = [...(last.steps || []), data];
              } else {
                updated.push({ task_id: data.step_id, steps: [data] });
              }
              return updated;
            });
            break;

          case 'step_error':
            setTasks((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last) last.steps = [...(last.steps || []), data];
              return updated;
            });
            break;

          case 'pending_approval':
            setOrbState('awaiting_approval');
            setApproval(data);
            break;

          case 'step_rejected':
            setApproval(null);
            setOrbState('idle');
            break;

          case 'stop':
            setOrbState('idle');
            break;
        }
      };

      ws.onclose = () => {
        console.log('[WS] disconnected, reconnecting...');
        reconnect = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => { clearTimeout(reconnect); wsRef.current?.close(); };
  }, []);

  const handleCommand = useCallback(async (text) => {
    setOrbState('processing');
    try {
      const res = await fetch(`${API}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await res.json();

      // If no WS updates came (e.g. simple gmail command), add results directly
      if (result.results?.length) {
        setTasks((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.steps.length === 0) {
            last.steps = result.results;
          } else {
            updated.push({ task_id: result.task_id, command: text, steps: result.results });
          }
          return updated;
        });
      }

      // Check if approval is pending (irreversible step)
      if (result.results?.some((r) => r.status === 'error')) {
        setOrbState('idle');
      } else {
        setTimeout(() => setOrbState('idle'), 1500);
      }
    } catch (err) {
      console.error('Command failed:', err);
      setOrbState('idle');
    }
  }, []);

  const handleApprove = useCallback(async (stepId) => {
    await fetch(`${API}/approve/${stepId}`, { method: 'POST' });
    setApproval(null);
    setOrbState('executing');
  }, []);

  const handleReject = useCallback(async (stepId) => {
    await fetch(`${API}/reject/${stepId}`, { method: 'POST' });
    setApproval(null);
    setOrbState('idle');
  }, []);

  const handleStop = useCallback(async () => {
    await fetch(`${API}/stop`, { method: 'POST' });
    setOrbState('idle');
    setApproval(null);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-bg-void text-text-primary overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-bg-panel shrink-0">
        <ListeningOrb state={orbState} />
        <h1 className="text-lg font-semibold tracking-wide">Jarwizz</h1>
        <button
          onClick={handleStop}
          className="
            px-4 py-1.5 rounded-lg text-sm font-medium
            border border-red-error/40 text-red-error
            hover:bg-red-error/10 transition-all duration-200
          "
        >
          Stop
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Task Queue */}
        <div className={`flex flex-col ${showLog ? 'w-1/2' : 'w-full'} border-r border-border-subtle transition-all duration-300`}>
          <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between">
            <span className="text-xs font-mono text-text-secondary uppercase tracking-wider">Task Queue</span>
            <button
              onClick={() => setShowLog(!showLog)}
              className="text-xs text-text-secondary hover:text-green-primary transition-colors"
            >
              {showLog ? 'Hide Logs' : 'Show Logs'}
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-3">
            <TaskQueue tasks={tasks} />
          </div>
        </div>

        {/* Right panel: Log Viewer */}
        {showLog && (
          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-2 border-b border-border-subtle">
              <span className="text-xs font-mono text-text-secondary uppercase tracking-wider">Action Log</span>
            </div>
            <div className="flex-1 overflow-hidden p-3">
              <LogViewer />
            </div>
          </div>
        )}
      </div>

      {/* Bottom: Command Box */}
      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-panel shrink-0">
        <CommandBox onCommand={handleCommand} />
      </footer>

      {/* Approval Modal */}
      <ApprovalModal
        approval={approval}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
