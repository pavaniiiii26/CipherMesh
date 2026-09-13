import IdentityAvatar from './IdentityAvatar';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

export default function ConversationListItem({
  contact,
  lastMessage,
  unreadCount = 0,
  isActive = false,
  onClick,
  onVerifyClick,
}) {
  const isGroup = Boolean(contact.group_id);
  const name = isGroup ? contact.name : (contact.display_name || contact.user_id?.substring(0, 10));

  let previewText = 'No messages yet';
  let timestampStr = '';

  if (lastMessage) {
    previewText = lastMessage.text || 'Encrypted message';
    if (lastMessage.timestamp) {
      const date = new Date(lastMessage.timestamp * 1000);
      const isToday = new Date().toDateString() === date.toDateString();
      timestampStr = isToday
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  } else if (contact.addedAt) {
    const date = new Date(contact.addedAt);
    timestampStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return (
    <div
      className={`conversation-list-item ${isActive ? 'active' : ''}`}
      onClick={() => onClick && onClick(contact)}
    >
      <IdentityAvatar
        name={name}
        userId={contact.user_id}
        online={contact.online}
        isGroup={isGroup}
        size={48}
      />

      <div className="conversation-content">
        <div className="conversation-row-top">
          <div className="conversation-name-wrapper">
            <span className="conversation-name">{name}</span>
            {!isGroup && contact.verified && (
              <span className="verified-shield-icon" title="Identity verified via Safety Numbers">
                <ShieldCheck size={15} color="#4F46E5" />
              </span>
            )}
            {!isGroup && contact.keyChanged && (
              <span className="warning-shield-icon" title="Contact's public key was recently replaced">
                <ShieldAlert size={15} color="#EF4444" />
              </span>
            )}
          </div>
          {timestampStr && <span className="conversation-time">{timestampStr}</span>}
        </div>

        <div className="conversation-row-bottom">
          <p className="conversation-preview">{previewText}</p>
          {unreadCount > 0 && (
            <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </div>
      </div>
    </div>
  );
}
