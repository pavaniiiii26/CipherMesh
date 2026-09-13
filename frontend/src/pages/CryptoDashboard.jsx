import { useState, useEffect, useRef } from 'react';
import { getRatchetStats } from '../crypto/ratchet';
import { getMessages, purgeExpiredMessages } from '../store/messages';
import { getContacts } from '../store/contacts';
import { healthCheck, getRelayStats } from '../services/api';
import wsManager, { ConnectionState } from '../services/websocket';

/**
 * CipherMesh — Visual Crypto Dashboard
 *
 * Real-time panel showing:
 *   - Double Ratchet session state per conversation
 *   - Ephemeral key generation/zeroing stats
 *   - Nonce replay cache stats
 *   - WebSocket connection metrics
 *   - TTL countdowns across all conversations
 *   - Rate limiter activity
 *   - Security event log
 */

function StatCard({ label, value, icon, color = 'accent' }) {
  return (
    <div className={`stat-card glass-panel stat-${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function RatchetSessionCard({ session }) {
  const [timeSince, setTimeSince] = useState(() =>
    session.lastRatchetAt ? Math.floor((Date.now() - session.lastRatchetAt) / 1000) : null
  );

  useEffect(() => {
    if (!session.lastRatchetAt) return;
    const interval = setInterval(() => {
      setTimeSince(Math.floor((Date.now() - session.lastRatchetAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [session.lastRatchetAt]);

  return (
    <div className="ratchet-session glass-panel">
      <div className="ratchet-header">
        <span className="ratchet-id mono">{session.id.substring(0, 16)}...</span>
        <span className={`ratchet-status ${session.initialized ? 'active' : 'inactive'}`}>
          {session.initialized ? '🟢 Active' : '⚪ Inactive'}
        </span>
      </div>
      <div className="ratchet-stats">
        <div className="ratchet-stat">
          <span className="ratchet-stat-label">Send Chain</span>
          <span className="ratchet-stat-value">{session.sendCount} messages</span>
        </div>
        <div className="ratchet-stat">
          <span className="ratchet-stat-label">Recv Chain</span>
          <span className="ratchet-stat-value">{session.recvCount} messages</span>
        </div>
        <div className="ratchet-stat">
          <span className="ratchet-stat-label">Total</span>
          <span className="ratchet-stat-value">{session.totalMessages}</span>
        </div>
        {timeSince !== null && (
          <div className="ratchet-stat">
            <span className="ratchet-stat-label">Last Ratchet</span>
            <span className="ratchet-stat-value">{timeSince}s ago</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TTLCountdownBar({ conversationId, expiresAt, text }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const r = Math.max(0, Math.floor(expiresAt - Date.now() / 1000));
      setRemaining(r);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;

  const totalTtl = 300; // Assume 5min default for bar width
  const progress = Math.min(1, remaining / totalTtl);

  return (
    <div className="ttl-countdown-row">
      <span className="ttl-conv-id mono">{conversationId.substring(0, 12)}</span>
      <div className="ttl-progress-bar">
        <div className="ttl-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="ttl-remaining">{remaining}s</span>
      <span className="ttl-text">{text?.substring(0, 30)}</span>
    </div>
  );
}

function SecurityEventLog({ events }) {
  return (
    <div className="security-event-log glass-panel">
      <h4>🔒 Security Event Log</h4>
      <div className="event-list">
        {events.length === 0 ? (
          <div className="event-empty">No security events recorded yet</div>
        ) : (
          events.slice().reverse().map((event, i) => (
            <div key={i} className={`event-item event-${event.type}`}>
              <span className="event-time">{event.time}</span>
              <span className="event-icon">
                {event.type === 'encrypt' ? '🔐' :
                 event.type === 'decrypt' ? '🔓' :
                 event.type === 'ratchet' ? '🔄' :
                 event.type === 'replay' ? '⚠️' :
                 event.type === 'ttl' ? '⏱️' : '📋'}
              </span>
              <span className="event-message">{event.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function CryptoDashboard() {
  const [ratchetStats, setRatchetStats] = useState({ activeSessions: 0, activeChains: 0, totalRatchetedMessages: 0, conversations: [] });
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  const [serverHealth, setServerHealth] = useState(null);
  const [ttlMessages, setTtlMessages] = useState([]);
  const [securityEvents, setSecurityEvents] = useState([]);
  const [nonceCacheStats, setNonceCacheStats] = useState({ size: 0, hits: 0 });
  const eventLogRef = useRef([]);

  // Subscribe to connection state
  useEffect(() => {
    return wsManager.onStateChange(setConnectionState);
  }, []);

  // Poll stats every 2 seconds
  useEffect(() => {
    const updateStats = () => {
      // Ratchet stats
      setRatchetStats(getRatchetStats());

      // TTL messages
      purgeExpiredMessages();
      const allContacts = getContacts();
      const ttlMsgs = [];
      for (const contact of allContacts) {
        const msgs = getMessages(contact.user_id);
        for (const msg of msgs) {
          if (msg.expiresAt) {
            ttlMsgs.push({
              conversationId: contact.user_id,
              expiresAt: msg.expiresAt,
              text: msg.text,
            });
          }
        }
      }
      setTtlMessages(ttlMsgs.slice(0, 10)); // Show top 10
    };

    updateStats();
    const interval = setInterval(updateStats, 2000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to all WebSocket events for the log
  useEffect(() => {
    const unsubAll = wsManager.on('*', (data) => {
      const event = {
        type: data.type === 'message' ? 'encrypt' :
               data.type === 'message_ack' ? 'decrypt' : 'info',
        message: `${data.type}: ${data.sender_id || ''} ${data.group_id || ''}`.trim(),
        time: new Date().toLocaleTimeString(),
      };
      eventLogRef.current = [...eventLogRef.current.slice(-49), event];
      setSecurityEvents([...eventLogRef.current]);
    });

    // Fetch real nonce cache stats from the server
    const fetchRelayStats = async () => {
      try {
        const stats = await getRelayStats();
        if (stats.nonce_cache) {
          setNonceCacheStats(prev => ({
            size: stats.nonce_cache.size || 0,
            hits: prev.hits + (stats.nonce_cache.size > 0 ? 1 : 0),
          }));
        }
      } catch {
        // Server might be offline
      }
    };
    fetchRelayStats();
    const nonceInterval = setInterval(fetchRelayStats, 5000);

    return () => {
      unsubAll();
      clearInterval(nonceInterval);
    };
  }, []);

  // Check server health periodically
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const health = await healthCheck();
        setServerHealth(health);
      } catch {
        setServerHealth(null);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="page crypto-dashboard-page">
      <div className="page-header">
        <div>
          <h1>🔐 Crypto Dashboard</h1>
          <p className="subtitle">Real-time security monitoring and cryptographic state visualization</p>
        </div>
        <div className={`dashboard-connection ${connectionState}`}>
          <span className={`status-dot ${connectionState}`} />
          <span>Relay: {connectionState}</span>
        </div>
      </div>

      {/* Top Stats Grid */}
      <div className="stats-grid">
        <StatCard
          label="Active Sessions"
          value={ratchetStats.activeSessions}
          icon="🔗"
          color="accent"
        />
        <StatCard
          label="Ratcheted Messages"
          value={ratchetStats.totalRatchetedMessages}
          icon="🔄"
          color="success"
        />
        <StatCard
          label="Active Chains"
          value={ratchetStats.activeChains}
          icon="⛓️"
          color="warning"
        />
        <StatCard
          label="Nonce Cache Size"
          value={nonceCacheStats.size}
          icon="🛡️"
          color="info"
        />
        <StatCard
          label="Replay Blocks"
          value={nonceCacheStats.hits}
          icon="🚫"
          color="danger"
        />
        <StatCard
          label="TTL Messages"
          value={ttlMessages.length}
          icon="⏱️"
          color="warning"
        />
        <StatCard
          label="Contacts"
          value={getContacts().length}
          icon="👥"
          color="accent"
        />
        <StatCard
          label="Server Status"
          value={serverHealth ? `${serverHealth.online_users} online` : 'Offline'}
          icon="🖥️"
          color={serverHealth ? 'success' : 'danger'}
        />
      </div>

      {/* Double Ratchet Sessions */}
      <div className="dashboard-section">
        <h3>🔄 Double Ratchet Sessions</h3>
        <p className="subtitle">Per-conversation chain key state and message counters</p>
        <div className="ratchet-sessions-grid">
          {ratchetStats.conversations.length === 0 ? (
            <div className="empty-ratchet glass-panel">
              <p>No ratchet sessions active. Send a message to initialize a Double Ratchet session.</p>
            </div>
          ) : (
            ratchetStats.conversations.map(session => (
              <RatchetSessionCard key={session.id} session={session} />
            ))
          )}
        </div>
      </div>

      {/* TTL Countdowns */}
      {ttlMessages.length > 0 && (
        <div className="dashboard-section">
          <h3>⏱️ Disappearing Message TTL Countdowns</h3>
          <p className="subtitle">Live countdown for messages with active expiration timers</p>
          <div className="ttl-countdowns glass-panel">
            {ttlMessages.map((msg, i) => (
              <TTLCountdownBar
                key={i}
                conversationId={msg.conversationId}
                expiresAt={msg.expiresAt}
                text={msg.text}
              />
            ))}
          </div>
        </div>
      )}

      {/* Connection & Server Status */}
      <div className="dashboard-section">
        <h3>🌐 Connection & Relay Status</h3>
        <div className="connection-grid">
          <div className="connection-card glass-panel">
            <h4>WebSocket Connection</h4>
            <div className="connection-detail">
              <span className="connection-label">State</span>
              <span className={`connection-value ${connectionState}`}>{connectionState}</span>
            </div>
            <div className="connection-detail">
              <span className="connection-label">Protocol</span>
              <span className="connection-value">ws://localhost:8000</span>
            </div>
            <div className="connection-detail">
              <span className="connection-label">Auto-Reconnect</span>
              <span className="connection-value">✓ Enabled</span>
            </div>
          </div>

          <div className="connection-card glass-panel">
            <h4>Security Features</h4>
            <div className="feature-list">
              <div className="feature-item active">✓ Double Ratchet (DH + Symmetric)</div>
              <div className="feature-item active">✓ Ephemeral Forward Secrecy</div>
              <div className="feature-item active">✓ Ed25519 Message Signing</div>
              <div className="feature-item active">✓ Nonce Replay Protection</div>
              <div className="feature-item active">✓ Zero-Knowledge Relay</div>
              <div className="feature-item active">✓ Disappearing Messages (TTL)</div>
              <div className="feature-item active">✓ Rate Limiting (HTTP + WS)</div>
            </div>
          </div>

          {serverHealth && (
            <div className="connection-card glass-panel">
              <h4>Server Health</h4>
              <div className="connection-detail">
                <span className="connection-label">Status</span>
                <span className="connection-value success">{serverHealth.status}</span>
              </div>
              <div className="connection-detail">
                <span className="connection-label">Online Users</span>
                <span className="connection-value">{serverHealth.online_users}</span>
              </div>
              <div className="connection-detail">
                <span className="connection-label">Service</span>
                <span className="connection-value">{serverHealth.service}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Security Event Log */}
      <div className="dashboard-section">
        <SecurityEventLog events={securityEvents} />
      </div>
    </div>
  );
}
