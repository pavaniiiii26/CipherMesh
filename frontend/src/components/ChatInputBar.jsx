import { useState, useRef } from 'react';
import { Paperclip, Send, Vote } from 'lucide-react';

export default function ChatInputBar({ onSend, onChange, value = '', placeholder = 'Message...', disabled = false }) {
  const [showPollMenu, setShowPollMenu] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOpt1, setPollOpt1] = useState('');
  const [pollOpt2, setPollOpt2] = useState('');
  const inputRef = useRef(null);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend();
      }
    }
  };

  const handleCreatePoll = () => {
    if (!pollQuestion.trim() || !pollOpt1.trim() || !pollOpt2.trim()) return;
    const pollText = `[POLL] ${pollQuestion.trim()} | ${pollOpt1.trim()} | ${pollOpt2.trim()}`;
    onSend(pollText);
    setPollQuestion('');
    setPollOpt1('');
    setPollOpt2('');
    setShowPollMenu(false);
  };

  return (
    <div className="chat-input-bar-container">
      {showPollMenu && (
        <div className="poll-creator-popover">
          <div className="popover-header">
            <span>Create Quick Poll</span>
            <button className="close-btn" onClick={() => setShowPollMenu(false)}>✕</button>
          </div>
          <input
            type="text"
            placeholder="Poll Question..."
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value)}
            className="poll-input"
          />
          <div className="poll-opts-row">
            <input
              type="text"
              placeholder="Option 1"
              value={pollOpt1}
              onChange={(e) => setPollOpt1(e.target.value)}
              className="poll-input"
            />
            <input
              type="text"
              placeholder="Option 2"
              value={pollOpt2}
              onChange={(e) => setPollOpt2(e.target.value)}
              className="poll-input"
            />
          </div>
          <button
            className="btn-submit-poll"
            onClick={handleCreatePoll}
            disabled={!pollQuestion.trim() || !pollOpt1.trim() || !pollOpt2.trim()}
          >
            Send Poll
          </button>
        </div>
      )}

      <div className="chat-input-row">
        <button
          className="input-action-btn"
          title="Create poll choice"
          onClick={() => setShowPollMenu(!showPollMenu)}
        >
          <Vote size={20} color="#6B7280" />
        </button>

        <button
          className="input-action-btn"
          title="Attach file"
          onClick={() => alert('Attachments are encrypted client-side in CipherMesh.')}
        >
          <Paperclip size={20} color="#6B7280" />
        </button>

        <textarea
          ref={inputRef}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="chat-text-input"
        />

        <button
          className="btn-send-message"
          onClick={() => onSend()}
          disabled={!value.trim() || disabled}
          title="Send encrypted message"
        >
          <Send size={18} color="#FFFFFF" />
        </button>
      </div>
    </div>
  );
}
