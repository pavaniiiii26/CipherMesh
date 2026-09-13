import { ConnectionState } from '../services/websocket';

const stateConfig = {
  [ConnectionState.ONLINE]: {
    label: 'Connected — End-to-end encrypted',
    icon: '🟢',
    className: 'status-online',
  },
  [ConnectionState.CONNECTING]: {
    label: 'Connecting to relay...',
    icon: '🟡',
    className: 'status-connecting',
  },
  [ConnectionState.OFFLINE]: {
    label: 'Offline — Messages will be queued',
    icon: '🔴',
    className: 'status-offline',
  },
  [ConnectionState.ERROR]: {
    label: 'Connection error — Retrying...',
    icon: '⚠️',
    className: 'status-error',
  },
};

export default function ConnectionStatus({ state }) {
  const config = stateConfig[state] || stateConfig[ConnectionState.OFFLINE];

  return (
    <div className={`connection-status ${config.className}`}>
      <span className="status-icon">{config.icon}</span>
      <span className="status-label">{config.label}</span>
    </div>
  );
}
