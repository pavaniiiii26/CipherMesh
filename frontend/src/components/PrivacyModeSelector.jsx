import { Zap, GitFork, EyeOff, Check, AlertCircle } from 'lucide-react';

const modes = [
  {
    id: 'direct',
    label: 'Direct',
    description: 'Fastest — messages route directly through the relay',
    icon: <Zap size={18} />,
  },
  {
    id: 'relay',
    label: 'Relay',
    description: 'Route through an intermediate node for metadata protection',
    icon: <GitFork size={18} />,
  },
  {
    id: 'anonymous',
    label: 'Anonymous',
    description: 'Onion-style routing for maximum privacy (slower)',
    icon: <EyeOff size={18} />,
  },
];

export default function PrivacyModeSelector({ value, onChange }) {
  return (
    <div className="privacy-mode-selector">
      <h3 className="setting-label">Network Privacy Mode</h3>
      <div className="privacy-modes">
        {modes.map(mode => (
          <button
            key={mode.id}
            className={`privacy-mode-option ${value === mode.id ? 'active' : ''}`}
            onClick={() => onChange(mode.id)}
          >
            <span className="mode-icon">{mode.icon}</span>
            <div className="mode-info">
              <div className="mode-label">{mode.label}</div>
              <div className="mode-desc">{mode.description}</div>
            </div>
            {value === mode.id && <span className="mode-check"><Check size={16} /></span>}
          </button>
        ))}
      </div>
      {value === 'anonymous' && (
        <div className="privacy-warning">
          <AlertCircle size={16} color="#F59E0B" />
          <span>Prototype: Anonymous mode currently simulates onion routing with server-side delays.</span>
        </div>
      )}
    </div>
  );
}
