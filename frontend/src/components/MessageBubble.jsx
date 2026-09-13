import { useState, useEffect } from 'react';
import { formatFileSize, getFileIcon } from '../crypto/fileSharing';

/**
 * CipherMesh — Message Bubble Component
 *
 * Renders:
 *   - Text messages with TTL countdown (disappearing messages)
 *   - File attachments (encrypted, decrypted client-side)
 *   - Self-destructing media with blur overlay
 *   - Group message signature verification badges
 *   - Read receipt status icons
 */

function SelfDestructingMedia({ file, expiresAt }) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    expiresAt ? Math.max(0, Math.floor(expiresAt - Date.now() / 1000)) : 0
  );
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor(expiresAt - Date.now() / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Blur intensity based on time remaining
  const progress = secondsRemaining > 0 ? Math.min(1, secondsRemaining / 300) : 0;
  const blurAmount = revealed ? 0 : Math.max(0, Math.min(20, 20 - (1 - progress) * 20));

  const formatCountdown = (sec) => {
    if (sec <= 0) return 'Expired';
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  };

  if (secondsRemaining <= 0) {
    return (
      <div className="self-destruct-expired">
        <span className="expired-icon">💀</span>
        <span className="expired-text">Media expired and purged</span>
      </div>
    );
  }

  const isVideo = file.type?.startsWith('video/');
  const isImage = file.type?.startsWith('image/');

  return (
    <div className="self-destruct-media">
      <div
        className="media-container"
        onClick={() => !revealed && setRevealed(true)}
        style={{ cursor: revealed ? 'default' : 'pointer' }}
      >
        {isImage && file.dataUrl && (
          <img
            src={file.dataUrl}
            alt={file.name}
            className="media-preview"
            style={{ filter: `blur(${blurAmount}px)` }}
          />
        )}
        {isVideo && file.dataUrl && (
          <video
            src={file.dataUrl}
            className="media-preview"
            controls={revealed}
            style={{ filter: `blur(${blurAmount}px)` }}
          />
        )}
        {!isImage && !isVideo && (
          <div className="file-attachment">
            <span className="file-icon">{getFileIcon(file.type)}</span>
            <div className="file-info">
              <span className="file-name">{file.name}</span>
              <span className="file-size">{formatFileSize(file.size)}</span>
            </div>
            {file.dataUrl && (
              <a href={file.dataUrl} download={file.name} className="btn btn-sm btn-accent">
                Download
              </a>
            )}
          </div>
        )}

        {!revealed && isImage && (
          <div className="reveal-overlay">
            <span className="reveal-icon">👁️</span>
            <span className="reveal-text">Tap to reveal</span>
          </div>
        )}
      </div>

      <div className="destruct-timer">
        <span className="timer-icon">⏱️</span>
        <span className="timer-countdown">{formatCountdown(secondsRemaining)}</span>
        <div className="timer-bar">
          <div
            className="timer-bar-fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function MessageBubble({ message, isOwn, onDelete }) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
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

  const hasFile = message.file && message.file.name;
  const isSelfDestructing = message.expiresAt && hasFile;

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

      {/* Render file attachment or self-destructing media */}
      {hasFile && isSelfDestructing && (
        <SelfDestructingMedia
          file={message.file}
          expiresAt={message.expiresAt}
          isOwn={isOwn}
        />
      )}

      {hasFile && !isSelfDestructing && (
        <div className="file-attachment">
          <span className="file-icon">{getFileIcon(message.file.type)}</span>
          <div className="file-info">
            <span className="file-name">{message.file.name}</span>
            <span className="file-size">{formatFileSize(message.file.size)}</span>
          </div>
          {message.file.dataUrl && (
            <a href={message.file.dataUrl} download={message.file.name} className="btn btn-sm btn-accent">
              Download
            </a>
          )}
        </div>
      )}

      {/* Render text content */}
      {message.text && <div className="message-text">{message.text}</div>}

      <div className="message-meta">
        {secondsRemaining !== null && !hasFile && (
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
