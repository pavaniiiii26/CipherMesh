import { NavLink, useNavigate } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';

export default function Navbar({ connectionState }) {
  const identity = getIdentity();
  const navigate = useNavigate();

  if (!identity) return null;

  return (
    <header className="app-header glass-panel">
      <div className="brand" onClick={() => navigate('/contacts')}>
        <div className="brand-logo">◈</div>
        <div className="brand-text">
          <span className="brand-name">CipherMesh</span>
          <span className="brand-badge">E2EE</span>
        </div>
      </div>

      <nav className="nav-links">
        <NavLink to="/contacts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          💬 Contacts
        </NavLink>
        <NavLink to="/groups" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          👥 Groups
        </NavLink>
        <NavLink to="/qr" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          📸 QR Code
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          ⚙️ Settings
        </NavLink>
      </nav>

      <div className="header-identity">
        <div className="identity-pill">
          <span className={`status-indicator ${connectionState}`} />
          <span className="identity-name">{identity.displayName}</span>
          <span className="identity-badge-mono mono">#{identity.userId.substring(0, 6)}</span>
        </div>
      </div>
    </header>
  );
}
