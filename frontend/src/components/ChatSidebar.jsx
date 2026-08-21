import { useState, useEffect } from 'react';

const API = '';

export default function ChatSidebar({ activeChatId, onSelectChat, onNewChat, refreshKey }) {
  const [chats, setChats] = useState([]);

  useEffect(() => {
    fetch(`${API}/chats`)
      .then(r => r.json())
      .then(setChats)
      .catch(() => {});
  }, [refreshKey]);

  return (
    <div className="w-64 flex flex-col border-r border-border-subtle bg-bg-panel shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
        <span className="text-xs font-mono text-text-secondary uppercase tracking-wider">Chats</span>
        <button
          onClick={onNewChat}
          className="text-xs text-green-primary hover:text-green-primary/80 font-mono transition-colors"
        >
          + New
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 && (
          <div className="px-4 py-6 text-center text-text-disabled text-xs font-mono">
            No chats yet
          </div>
        )}
        {chats.map(chat => (
          <button
            key={chat.id}
            onClick={() => onSelectChat(chat.id)}
            className={`w-full text-left px-4 py-3 border-b border-border-subtle/30 transition-colors ${
              activeChatId === chat.id
                ? 'bg-green-primary/10 border-l-2 border-l-green-primary'
                : 'hover:bg-bg-elevated border-l-2 border-l-transparent'
            }`}
          >
            <div className="text-sm text-text-primary truncate">{chat.title}</div>
            <div className="text-[10px] font-mono text-text-disabled mt-0.5">
              {new Date(chat.updated_at).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
