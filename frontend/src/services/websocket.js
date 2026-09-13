/**
 * CipherMesh — WebSocket Client Manager
 *
 * Manages the WebSocket connection to the relay server with:
 *   - Automatic reconnection with exponential backoff
 *   - Offline message queue (persisted to localStorage)
 *   - Connection state management (CONNECTING, ONLINE, OFFLINE, ERROR)
 *   - Event-based message dispatch
 *
 * PRODUCTION NOTES:
 *   - Add TLS (wss://) for encrypted transport layer
 *   - Add heartbeat/ping to detect silent disconnections
 *   - Add message ordering guarantees (sequence numbers)
 */

const WS_BASE = 'ws://localhost:8000/ws';
const QUEUE_STORAGE_KEY = 'ciphermesh_msg_queue';
const MAX_RECONNECT_DELAY = 30000; // 30 seconds max backoff

export const ConnectionState = {
  CONNECTING: 'connecting',
  ONLINE: 'online',
  OFFLINE: 'offline',
  ERROR: 'error',
};

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.userId = null;
    this.state = ConnectionState.OFFLINE;
    this.listeners = new Map();
    this.stateListeners = new Set();
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.messageQueue = this._loadQueue();
  }

  /**
   * Connect to the relay server.
   * @param {string} userId - The authenticated user's ID
   */
  connect(userId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.userId = userId;
    this._setState(ConnectionState.CONNECTING);

    try {
      this.ws = new WebSocket(`${WS_BASE}/${userId}`);

      this.ws.onopen = () => {
        console.log('[WS] Connected to relay');
        this.reconnectAttempts = 0;
        this._setState(ConnectionState.ONLINE);
        this._flushQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._dispatch(data.type, data);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason);
        this._setState(ConnectionState.OFFLINE);
        this._scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        this._setState(ConnectionState.ERROR);
      };
    } catch (err) {
      console.error('[WS] Failed to create connection:', err);
      this._setState(ConnectionState.ERROR);
      this._scheduleReconnect();
    }
  }

  /**
   * Disconnect from the relay server.
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }
    this._setState(ConnectionState.OFFLINE);
  }

  /**
   * Send a message through the WebSocket. If offline, queue it.
   * @param {object} data - Message envelope to send
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      // Queue for later delivery
      this.messageQueue.push(data);
      this._saveQueue();
      console.log('[WS] Message queued (offline). Queue size:', this.messageQueue.length);
    }
  }

  /**
   * Subscribe to a specific message type.
   * @param {string} type - Message type (e.g., 'message', 'presence', 'typing')
   * @param {function} callback - Handler function
   * @returns {function} Unsubscribe function
   */
  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(callback);

    return () => {
      const typeListeners = this.listeners.get(type);
      if (typeListeners) {
        typeListeners.delete(callback);
      }
    };
  }

  /**
   * Subscribe to connection state changes.
   * @param {function} callback - Handler receiving new state
   * @returns {function} Unsubscribe function
   */
  onStateChange(callback) {
    this.stateListeners.add(callback);
    // Immediately emit current state
    callback(this.state);
    return () => this.stateListeners.delete(callback);
  }

  /**
   * Subscribe to presence updates for a list of contacts.
   */
  subscribePresence(contactIds) {
    this.send({
      type: 'presence_subscribe',
      contact_ids: contactIds,
    });
  }

  /**
   * Send a typing indicator.
   */
  sendTyping(recipientId, groupId = null) {
    this.send({
      type: 'typing',
      recipient_id: recipientId,
      group_id: groupId,
    });
  }

  // ─── Private Methods ────────────────────────────────────────────

  _setState(newState) {
    if (this.state !== newState) {
      this.state = newState;
      this.stateListeners.forEach(cb => cb(newState));
    }
  }

  _dispatch(type, data) {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.forEach(cb => cb(data));
    }

    // Also dispatch to wildcard listeners
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      wildcardListeners.forEach(cb => cb(data));
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at MAX_RECONNECT_DELAY
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userId) {
        this.connect(this.userId);
      }
    }, delay);
  }

  _flushQueue() {
    if (this.messageQueue.length === 0) return;

    console.log(`[WS] Flushing ${this.messageQueue.length} queued messages`);
    const queue = [...this.messageQueue];
    this.messageQueue = [];
    this._saveQueue();

    queue.forEach(msg => this.send(msg));
  }

  _loadQueue() {
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  _saveQueue() {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.messageQueue));
  }
}

// Singleton instance
const wsManager = new WebSocketManager();
export default wsManager;
