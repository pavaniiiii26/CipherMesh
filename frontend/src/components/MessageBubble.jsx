import { useState, useEffect } from 'react';

export default function MessageBubble({ message, isOwn, onDelete }) {
  const [secondsRemaining, setSecondsRemaining] = useState(
    message.expiresAt ? Math.max(0, Math.floor(message.expiresAt - Date.now() / 1000)) : null
  );

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

  const statusIcons = {
    sending: '⏳',
    sent: '✓',
    delivered: '✓✓',
    read: '✓✓',
    failed: '✗',
  };

  const formatTtl = (sec) => {
    if (sec <= 0) return 'expired';
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h`;
  };

  return (
    <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
      {!isOwn && message.senderName && (
        <div className="message-sender">
          {message.senderName}
          {message.signatureVerified === true && (
            <span className="signature-badge verified" title="Digital signature verified (Ed25519)">
              ✓ Verified
            </span>
          )}
          {message.signatureVerified === false && (
            <span className="signature-badge warning" title="Signature could not be verified">
              ⚠️ Unsigned
            </span>
          )}
        </div>
      )}

      <div className="message-text">{message.text}</div>

      <div className="message-meta">
        {secondsRemaining !== null && (
          <span className="message-ttl" title="Disappearing message">
            ⏱️ {formatTtl(secondsRemaining)}
          </span>
        )}

        <span className="message-time">{time}</span>

        {isOwn && (
          <span className={`message-status ${message.status}`}>
            {statusIcons[message.status] || ''}
          </span>
        )}

        {onDelete && (
          <button
            className="message-delete-btn"
            onClick={() => onDelete(message.id)}
            title="Delete message"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
