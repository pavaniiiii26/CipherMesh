import { ConnectionState } from '../services/websocket';
import { Wifi, WifiOff, AlertTriangle, RefreshCw } from 'lucide-react';

export default function ConnectionStatus({ state }) {
  if (state === ConnectionState.ONLINE) return null; // Keep header clean when online

  const stateConfig = {
    [ConnectionState.CONNECTING]: {
      label: 'Connecting to relay...',
      icon: <RefreshCw size={14} className="spin-icon" />,
      className: 'status-connecting',
    },
    [ConnectionState.OFFLINE]: {
      label: 'Offline — Messages will be queued',
      icon: <WifiOff size={14} />,
      className: 'status-offline',
    },
    [ConnectionState.ERROR]: {
      label: 'Connection error — Retrying...',
      icon: <AlertTriangle size={14} />,
      className: 'status-error',
    },
  };

  const config = stateConfig[state] || stateConfig[ConnectionState.OFFLINE];

  return (
    <div className={`connection-status-banner ${config.className}`}>
      <span className="status-banner-icon">{config.icon}</span>
      <span className="status-banner-label">{config.label}</span>
    </div>
  );
}
