import { ArrowLeft, ShieldCheck, ShieldAlert, Timer, Lock } from 'lucide-react';
import IdentityAvatar from './IdentityAvatar';

export default function ChatHeader({
  title,
  contact,
  isGroup,
  online = false,
  typing = false,
  ttl = 0,
  onTtlChange,
  onBack,
  onVerifyClick,
}) {
  const TTL_OPTIONS = [
    { label: 'TTL: Off', value: 0 },
    { label: '30s', value: 30 },
    { label: '5m', value: 300 },
    { label: '1h', value: 3600 },
    { label: '24h', value: 86400 },
  ];

  return (
    <div className="chat-header-bar">
      <div className="chat-header-left">
        {onBack && (
          <button className="chat-header-back-btn" onClick={onBack} title="Back">
            <ArrowLeft size={20} />
          </button>
        )}

        <div className="chat-header-user-info">
          <div className="chat-header-title-row">
            <h2 className="chat-header-title">{title}</h2>
            {!isGroup && contact?.verified && (
              <span className="header-badge-verified" title="Safety Numbers Verified">
                <ShieldCheck size={16} color="#4F46E5" />
              </span>
            )}
            {!isGroup && contact?.keyChanged && (
              <span className="header-badge-warning" title="Public key was replaced">
                <ShieldAlert size={16} color="#EF4444" />
              </span>
            )}
          </div>

          <div className="chat-header-status-row">
            {typing ? (
              <span className="chat-status-typing">typing...</span>
            ) : isGroup ? (
              <span className="chat-status-sub">Group Chat</span>
            ) : (
              <span className={`chat-status-dot-text ${online ? 'online' : 'offline'}`}>
                {online ? 'Online' : 'Offline'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="chat-header-right">
        {/* Disappearing Messages TTL Selector */}
        <div className="ttl-picker-container" title="Disappearing messages timer">
          <Timer size={16} className="ttl-icon" />
          <select
            value={ttl}
            onChange={(e) => onTtlChange && onTtlChange(Number(e.target.value))}
            className="ttl-select-input"
          >
            {TTL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {!isGroup && contact && onVerifyClick && (
          <button
            className={`btn-verify-badge ${contact.verified ? 'verified' : 'unverified'}`}
            onClick={() => onVerifyClick(contact)}
            title="Verify identity safety numbers"
          >
            <ShieldCheck size={14} />
            <span>{contact.verified ? 'Verified' : 'Verify Key'}</span>
          </button>
        )}

        <div className="header-e2ee-tag" title="End-to-End Encrypted with Forward Secrecy">
          <Lock size={14} />
        </div>

        <IdentityAvatar
          name={title}
          userId={contact?.user_id}
          online={online}
          isGroup={isGroup}
          size={36}
        />
      </div>
    </div>
  );
}
