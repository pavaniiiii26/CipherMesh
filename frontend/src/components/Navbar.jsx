import { NavLink, useNavigate } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';
import IdentityAvatar from './IdentityAvatar';
import { Shield, MessageSquare, Users, QrCode, Settings } from 'lucide-react';

export default function Navbar({ connectionState }) {
  const identity = getIdentity();
  const navigate = useNavigate();

  if (!identity) return null;

  return (
    <header className="app-top-header">
      <div className="brand" onClick={() => navigate('/contacts')}>
        <div className="brand-logo">
          <Shield size={22} color="#5B6EF5" />
        </div>
        <div className="brand-text">
          <span className="brand-name">CipherMesh</span>
          <span className="brand-tag">E2EE</span>
        </div>
      </div>

      <nav className="desktop-nav-links">
        <NavLink to="/contacts" className={({ isActive }) => `desktop-nav-link ${isActive ? 'active' : ''}`}>
          <MessageSquare size={17} />
          <span>Chats</span>
        </NavLink>
        <NavLink to="/groups" className={({ isActive }) => `desktop-nav-link ${isActive ? 'active' : ''}`}>
          <Users size={17} />
          <span>Groups</span>
        </NavLink>
        <NavLink to="/qr" className={({ isActive }) => `desktop-nav-link ${isActive ? 'active' : ''}`}>
          <QrCode size={17} />
          <span>My QR</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `desktop-nav-link ${isActive ? 'active' : ''}`}>
          <Settings size={17} />
          <span>Settings</span>
        </NavLink>
      </nav>

      <div className="header-user-profile" onClick={() => navigate('/settings')}>
        <IdentityAvatar
          name={identity.displayName}
          userId={identity.userId}
          online={connectionState === 'online'}
          size={34}
        />
        <div className="header-user-meta">
          <span className="user-display-name">{identity.displayName}</span>
          <span className="user-id-sub mono">#{identity.userId.substring(0, 6)}</span>
        </div>
      </div>
    </header>
  );
}
