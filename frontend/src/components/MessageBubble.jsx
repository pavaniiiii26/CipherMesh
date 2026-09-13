import { useState, useEffect } from 'react';
import { Check, CheckCheck, Clock, ShieldCheck, ShieldAlert, Timer, Trash2 } from 'lucide-react';

export default function MessageBubble({ message, isOwn, onDelete, onChoiceSelect }) {
  const [secondsRemaining, setSecondsRemaining] = useState(
    message.expiresAt ? Math.max(0, Math.floor(message.expiresAt - Date.now() / 1000)) : null
  );
  const [selectedChoice, setSelectedChoice] = useState(null);

  useEffect(() => {
    if (!message.expiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor(message.expiresAt - Date.now() / 1000));
      setSecondsRemaining(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [message.expiresAt]);

  const time = new Date(message.timestamp * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const formatTtl = (sec) => {
    if (sec <= 0) return 'expired';
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h`;
  };

  // Check if text includes poll/choice markup or options e.g. [POLL] Question | Option A | Option B
  let choices = null;
  let textContent = message.text;

  if (message.choices) {
    choices = message.choices;
  } else if (message.text && message.text.startsWith('[POLL]')) {
    const parts = message.text.replace('[POLL]', '').split('|').map(s => s.trim());
    if (parts.length > 1) {
      textContent = parts[0];
      choices = parts.slice(1);
    }
  }

  const handleChoice = (option) => {
    setSelectedChoice(option);
    if (onChoiceSelect) onChoiceSelect(option, message);
  };

  return (
    <div className={`message-bubble-wrapper ${isOwn ? 'own' : 'other'}`}>
      <div className={`message-bubble ${isOwn ? 'sent' : 'received'}`}>
        {!isOwn && message.senderName && (
          <div className="message-sender-header">
            <span className="sender-name">{message.senderName}</span>
            {message.signatureVerified === true && (
              <span className="signature-tag verified" title="Digital signature verified (Ed25519)">
                <ShieldCheck size={12} />
                <span>Verified</span>
              </span>
            )}
            {message.signatureVerified === false && (
              <span className="signature-tag warning" title="Signature unverified">
                <ShieldAlert size={12} />
                <span>Unverified</span>
              </span>
            )}
          </div>
        )}

        <div className="message-text-content">{textContent}</div>

        {/* Inline Poll / Button Choice Bubble Support */}
        {choices && choices.length > 0 && (
          <div className="message-poll-choices">
            {choices.map((choice, idx) => (
              <button
                key={idx}
                className={`poll-choice-btn ${selectedChoice === choice ? 'selected' : ''}`}
                onClick={() => handleChoice(choice)}
              >
                <span>{choice}</span>
                {selectedChoice === choice && <Check size={14} />}
              </button>
            ))}
          </div>
        )}

        <div className="message-meta-footer">
          {secondsRemaining !== null && (
            <span className="message-ttl-indicator" title="Disappearing message">
              <Timer size={12} />
              <span>{formatTtl(secondsRemaining)}</span>
            </span>
          )}

          <span className="message-timestamp">{time}</span>

          {isOwn && (
            <span className={`message-status-icon ${message.status}`}>
              {message.status === 'sending' && <Clock size={13} className="spin-icon" />}
              {message.status === 'sent' && <Check size={13} />}
              {(message.status === 'delivered' || message.status === 'read') && (
                <CheckCheck size={14} className={message.status === 'read' ? 'read' : ''} />
              )}
            </span>
          )}

          {onDelete && (
            <button
              className="message-delete-action"
              onClick={() => onDelete(message.id)}
              title="Delete message"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
