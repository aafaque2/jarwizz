import { useState, useEffect, useRef, useCallback } from 'react';
import ListeningOrb from './components/ListeningOrb';
import CommandBox from './components/CommandBox';
import ChatView from './components/ChatView';
import ChatSidebar from './components/ChatSidebar';
import ApprovalModal from './components/ApprovalModal';
import LogViewer from './components/LogViewer';

const API = '';
const WS_URL = `ws://${window.location.host}/ws`;

export default function App() {
  const [orbState, setOrbState] = useState('idle');
  const [approval, setApproval] = useState(null);
  const [showLog, setShowLog] = useState(false);

  // Chat state
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatMessages, setChatMessages] = useState({});
  const [currentTask, setCurrentTask] = useState(null);
  const [chatRefreshKey, setChatRefreshKey] = useState(0);

  const wsRef = useRef(null);
  const abortRef = useRef(null);

  // Append an assistant message, deduping against recent assistant bubbles.
  // The reply arrives via BOTH the WS event and the HTTP response — without
  // this it renders twice. Time-boxed so identical consecutive answers
  // (e.g. asking the same question twice) still show up.
  const pushAssistantMessage = useCallback((chatId, content) => {
    setChatMessages(prev => {
      const existing = prev[chatId] || [];
      const now = Date.now();
      for (let i = existing.length - 1; i >= 0 && existing[i].role === 'assistant'; i--) {
        const age = now - new Date(existing[i].created_at).getTime();
        if (age < 10000 && existing[i].content === content) return prev;
      }
      return {
        ...prev,
        [chatId]: [...existing, {
          id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: 'assistant',
          content,
          created_at: new Date().toISOString(),
        }],
      };
    });
    setChatRefreshKey(k => k + 1);
  }, []);

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
            setCurrentTask(prev => {
              // Dedupe: ignore if same task_id already set
              const newId = data.plan?.task_id || data.plan?.steps?.[0]?.step_id;
              if (prev && prev.task_id === newId) return prev;
              return {
                task_id: newId,
                command: data.plan?._originalCommand || 'Task',
                steps: [],
                totalSteps: data.plan?.steps?.length || 0,
                chat_id: data.chat_id,
              };
            });
            break;

          case 'conversational_reply': {
            setOrbState('response');
            const chatId = data.chat_id;
            if (chatId) {
              pushAssistantMessage(chatId, data.text);
            }
            setTimeout(() => setOrbState('idle'), 2000);
            break;
          }

          case 'step_completed':
            setOrbState('executing');
            setCurrentTask(prev => {
              if (!prev) return prev;
              const existing = prev.steps || [];
              if (existing.some(s => s.step_id === data.step_id)) return prev;
              return { ...prev, steps: [...existing, data] };
            });
            break;

          case 'step_error':
            setCurrentTask(prev => {
              if (!prev) return prev;
              const existing = prev.steps || [];
              if (existing.some(s => s.step_id === data.step_id)) return prev;
              return { ...prev, steps: [...existing, data] };
            });
            break;

          case 'step_skipped':
            setCurrentTask(prev => {
              if (!prev) return prev;
              const existing = prev.steps || [];
              if (existing.some(s => s.step_id === data.step_id)) return prev;
              return { ...prev, steps: [...existing, data] };
            });
            break;

          case 'pending_approval':
            console.log('[APPROVAL] Received:', data);
            // Dedupe: ignore if same step_id already pending
            setApproval(prev => {
              if (prev && prev.step_id === data.step_id) return prev;
              return data;
            });
            setOrbState('awaiting_approval');
            break;

          case 'step_approved':
            setApproval(null);
            setOrbState('executing');
            break;

          case 'step_rejected':
            setApproval(null);
            // Plan continues to the next step — keep live task visible;
            // 'plan_finished' clears it when the run ends
            setOrbState('executing');
            break;

          case 'stop':
            setOrbState('idle');
            setApproval(null);
            setCurrentTask(null);
            break;

          case 'plan_finished':
            setOrbState('idle');
            setCurrentTask(null);
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
  }, [pushAssistantMessage]);

  // Load chat messages when selecting a chat
  const handleSelectChat = useCallback(async (chatId) => {
    setActiveChatId(chatId);
    setCurrentTask(null);
    try {
      const res = await fetch(`${API}/chats/${chatId}`);
      const chat = await res.json();
      setChatMessages(prev => ({ ...prev, [chatId]: chat.messages || [] }));
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  }, []);

  // Create new chat
  const handleNewChat = useCallback(async () => {
    try {
      const res = await fetch(`${API}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const chat = await res.json();
      setActiveChatId(chat.id);
      setChatMessages(prev => ({ ...prev, [chat.id]: [] }));
      setChatRefreshKey(k => k + 1);
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }, []);

  // Send command in chat context
  const handleCommand = useCallback(async (text) => {
    // If no active chat, create one first
    let chatId = activeChatId;
    if (!chatId) {
      try {
        const res = await fetch(`${API}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.length > 40 ? text.substring(0, 40) + '...' : text }),
        });
        const chat = await res.json();
        chatId = chat.id;
        setActiveChatId(chatId);
        setChatMessages(prev => ({ ...prev, [chatId]: [] }));
        setChatRefreshKey(k => k + 1);
      } catch (err) {
        console.error('Failed to create chat:', err);
        return;
      }
    }

    // Add user message to UI immediately
    setChatMessages(prev => ({
      ...prev,
      [chatId]: [...(prev[chatId] || []), {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      }],
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    setOrbState('processing');
    try {
      const res = await fetch(`${API}/chats/${chatId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const result = await res.json();

      // Add assistant reply to chat (deduped — WS already delivered it)
      if (result.reply) {
        pushAssistantMessage(chatId, result.reply);
        setOrbState('response');
        setTimeout(() => setOrbState('idle'), 2000);
        setCurrentTask(null);
        return;
      }

      if (result.results?.some((r) => r.status === 'pending_approval')) {
        // Waiting for approval
      } else if (result.results?.some((r) => r.status === 'error')) {
        setOrbState('idle');
        setCurrentTask(null);
      } else {
        setTimeout(() => { setOrbState('idle'); setCurrentTask(null); }, 1500);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[CMD] Aborted by user');
      } else {
        console.error('Command failed:', err);
      }
      setOrbState('idle');
      setCurrentTask(null);
    } finally {
      abortRef.current = null;
    }
  }, [activeChatId, pushAssistantMessage]);

  const handleApprove = useCallback(async (stepId) => {
    await fetch(`${API}/approve/${stepId}`, { method: 'POST' });
    setApproval(null);
    setOrbState('executing');
  }, []);

  const handleReject = useCallback(async (stepId) => {
    await fetch(`${API}/reject/${stepId}`, { method: 'POST' });
    setApproval(null);
    setOrbState('executing');
  }, []);

  const handleStop = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    await fetch(`${API}/stop`, { method: 'POST' });
    setOrbState('idle');
    setApproval(null);
    setCurrentTask(null);
  }, []);

  // Build the active chat object with messages
  const activeChat = activeChatId ? {
    id: activeChatId,
    messages: chatMessages[activeChatId] || [],
  } : null;

  return (
    <>
    <div className="h-screen flex flex-col bg-bg-void text-text-primary">
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
      <div className="flex-1 flex min-h-0">
        {/* Chat sidebar */}
        <ChatSidebar
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          refreshKey={chatRefreshKey}
        />

        {/* Chat view */}
        <div className={`flex-1 flex flex-col min-h-0 ${showLog ? 'w-1/2' : ''}`}>
          <ChatView chat={activeChat} currentTask={currentTask} />
        </div>

        {/* Log panel */}
        {showLog && (
          <div className="w-1/2 flex flex-col min-h-0 border-l border-border-subtle">
            <div className="px-4 py-2 border-b border-border-subtle shrink-0">
              <span className="text-xs font-mono text-text-secondary uppercase tracking-wider">Action Log</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 min-h-0">
              <LogViewer />
            </div>
          </div>
        )}
      </div>

      {/* Bottom: Command Box */}
      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-panel shrink-0">
        <CommandBox onCommand={handleCommand} />
      </footer>

      {/* Approval Modal — rendered inside main div with fixed positioning */}
      <ApprovalModal
        approval={approval}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
    </>
  );
}
