import { NavLink } from 'react-router-dom';
import { MessageSquare, Users, QrCode, Settings, ShieldCheck } from 'lucide-react';

export default function BottomTabBar({ unreadCount = 0 }) {
  return (
    <nav className="mobile-bottom-tab-bar">
      <NavLink
        to="/contacts"
        className={({ isActive }) => `bottom-tab-item ${isActive ? 'active' : ''}`}
      >
        <div className="tab-icon-wrapper">
          <MessageSquare size={22} />
          {unreadCount > 0 && <span className="tab-unread-dot" />}
        </div>
        <span className="tab-label">Chats</span>
      </NavLink>

      <NavLink
        to="/groups"
        className={({ isActive }) => `bottom-tab-item ${isActive ? 'active' : ''}`}
      >
        <div className="tab-icon-wrapper">
          <Users size={22} />
        </div>
        <span className="tab-label">Groups</span>
      </NavLink>

      <NavLink
        to="/qr"
        className={({ isActive }) => `bottom-tab-item ${isActive ? 'active' : ''}`}
      >
        <div className="tab-icon-wrapper">
          <QrCode size={22} />
        </div>
        <span className="tab-label">My QR</span>
      </NavLink>

      <NavLink
        to="/settings"
        className={({ isActive }) => `bottom-tab-item ${isActive ? 'active' : ''}`}
      >
        <div className="tab-icon-wrapper">
          <Settings size={22} />
        </div>
        <span className="tab-label">Settings</span>
      </NavLink>
    </nav>
  );
}
