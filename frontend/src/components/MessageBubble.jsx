export default function MessageBubble({ message, isOwn }) {
  const time = new Date(message.timestamp * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const statusIcons = {
    sending: '⏳',
    sent: '✓',
    delivered: '✓✓',
    failed: '✗',
  };

  return (
    <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
      {!isOwn && message.senderName && (
        <div className="message-sender">{message.senderName}</div>
      )}
      <div className="message-text">{message.text}</div>
      <div className="message-meta">
        <span className="message-time">{time}</span>
        {isOwn && (
          <span className={`message-status ${message.status}`}>
            {statusIcons[message.status] || ''}
          </span>
        )}
      </div>
    </div>
  );
}
