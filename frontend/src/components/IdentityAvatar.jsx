import { User, Users } from 'lucide-react';

export default function IdentityAvatar({ name, userId, size = 44, online = false, isGroup = false, className = '' }) {
  const getInitials = (str) => {
    if (!str) return '?';
    const parts = str.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return str.slice(0, 2).toUpperCase();
  };

  // Color generator based on string hash for avatar background
  const getAvatarBg = (str) => {
    if (!str) return 'linear-gradient(135deg, #6366F1, #4F46E5)';
    const colors = [
      'linear-gradient(135deg, #5B6EF5, #4338CA)',
      'linear-gradient(135deg, #0EA5E9, #0284C7)',
      'linear-gradient(135deg, #10B981, #059669)',
      'linear-gradient(135deg, #F59E0B, #D97706)',
      'linear-gradient(135deg, #EC4899, #BE185D)',
      'linear-gradient(135deg, #8B5CF6, #6D28D9)',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  const displayName = name || userId || 'User';
  const background = isGroup ? 'linear-gradient(135deg, #6366F1, #4338CA)' : getAvatarBg(displayName);

  return (
    <div
      className={`identity-avatar-wrapper ${className}`}
      style={{ width: `${size}px`, height: `${size}px`, minWidth: `${size}px` }}
    >
      <div
        className="identity-avatar-inner"
        style={{
          background,
          fontSize: `${Math.max(12, Math.floor(size * 0.4))}px`,
        }}
      >
        {isGroup ? (
          <Users size={Math.floor(size * 0.5)} color="#FFFFFF" />
        ) : (
          <span>{getInitials(displayName)}</span>
        )}
      </div>
      {online && !isGroup && <span className="avatar-online-dot" />}
    </div>
  );
}
