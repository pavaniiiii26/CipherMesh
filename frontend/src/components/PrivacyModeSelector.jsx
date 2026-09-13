/**
 * Privacy mode selector for network routing.
 *
 * PRODUCTION NOTES:
 *   - "Direct" mode: Messages go straight to the relay server (fastest).
 *   - "Relay" mode: For the prototype, this behaves identically to Direct.
 *     In production, it would route through an intermediate relay node.
 *   - "Anonymous" mode: Currently simulates onion routing with a random delay
 *     on the server. In production, this would use Tor hidden services or
 *     a mixnet protocol (e.g., Nym) for real anonymity.
 */

const modes = [
  {
    id: 'direct',
    label: 'Direct',
    description: 'Fastest — messages route directly through the relay',
    icon: '⚡',
  },
  {
    id: 'relay',
    label: 'Relay',
    description: 'Route through an intermediate node for metadata protection',
    icon: '🔀',
  },
  {
    id: 'anonymous',
    label: 'Anonymous',
    description: 'Onion-style routing for maximum privacy (slower)',
    icon: '🧅',
    // PLACEHOLDER: This currently just adds a random delay server-side.
    // Real implementation needs Tor/mixnet integration.
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
            {value === mode.id && <span className="mode-check">✓</span>}
          </button>
        ))}
      </div>
      {value === 'anonymous' && (
        <div className="privacy-warning">
          ⚠️ Prototype: Anonymous mode currently simulates onion routing with
          server-side delays. Real Tor/mixnet integration is needed for production.
        </div>
      )}
    </div>
  );
}
