/**
 * CipherMesh — Local Message Store
 *
 * Decrypted messages are stored CLIENT-SIDE ONLY in localStorage.
 * The server only ever sees encrypted blobs.
 *
 * Features:
 *   - Auto-purging for Disappearing Messages (TTL)
 *   - Nonce-based replay protection
 *   - Read receipt tracking ('sending' | 'sent' | 'delivered' | 'read')
 *   - Digital signature verification badges for group chats
 */

const MESSAGES_KEY = 'ciphermesh_messages';
const SEEN_NONCES_KEY = 'ciphermesh_seen_nonces';

function loadSeenNonces() {
  try {
    const raw = localStorage.getItem(SEEN_NONCES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function recordSeenNonce(nonce) {
  if (!nonce) return;
  try {
    const set = loadSeenNonces();
    set.add(nonce);
    // Keep set bounded to last 1000 nonces
    const arr = Array.from(set).slice(-1000);
    localStorage.setItem(SEEN_NONCES_KEY, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

function isNonceSeen(nonce) {
  if (!nonce) return false;
  return loadSeenNonces().has(nonce);
}

function loadAllMessages() {
  try {
    const stored = localStorage.getItem(MESSAGES_KEY);
    const all = stored ? JSON.parse(stored) : {};
    const now = Date.now() / 1000;
    let changed = false;

    // Filter out expired messages
    for (const cid of Object.keys(all)) {
      const filtered = all[cid].filter(m => !m.expiresAt || m.expiresAt > now);
      if (filtered.length !== all[cid].length) {
        all[cid] = filtered;
        changed = true;
      }
    }

    if (changed) {
      saveAllMessages(all);
    }
    return all;
  } catch {
    return {};
  }
}

function saveAllMessages(allMessages) {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(allMessages));
}

/**
 * Get messages for a conversation, automatically filtering out expired ones.
 * @param {string} conversationId - Contact user_id or group_id
 */
export function getMessages(conversationId) {
  const all = loadAllMessages();
  return all[conversationId] || [];
}

/**
 * Add a message to a conversation with replay protection and TTL support.
 * @param {string} conversationId - Contact user_id or group_id
 * @param {object} message
 */
export function addMessage(conversationId, message) {
  const all = loadAllMessages();
  if (!all[conversationId]) {
    all[conversationId] = [];
  }

  // Replay protection: check if nonce was already received
  if (message.nonce && isNonceSeen(message.nonce)) {
    console.warn('[Replay Protection] Dropped duplicate replayed message nonce:', message.nonce);
    return all[conversationId];
  }

  // Avoid duplicates by server message ID
  if (message.id && all[conversationId].some(m => m.id === message.id)) {
    return all[conversationId];
  }

  if (message.nonce) {
    recordSeenNonce(message.nonce);
  }

  const now = Date.now() / 1000;
  const ttl = message.ttl || null;
  const expiresAt = message.expiresAt || (ttl ? now + ttl : null);

  all[conversationId].push({
    id: message.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderId: message.senderId,
    senderName: message.senderName || null,
    text: message.text,
    timestamp: message.timestamp || now,
    status: message.status || 'sent', // 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
    isGroup: message.isGroup || false,
    nonce: message.nonce || null,
    ttl,
    expiresAt,
    signatureVerified: message.signatureVerified ?? null,
  });

  saveAllMessages(all);
  return all[conversationId];
}

/**
 * Update a message's status (e.g., from 'sending' to 'delivered' or 'read').
 */
export function updateMessageStatus(conversationId, localId, newStatus, serverId = null) {
  const all = loadAllMessages();
  const messages = all[conversationId] || [];
  const msg = messages.find(m => m.id === localId);
  if (msg) {
    msg.status = newStatus;
    if (serverId) msg.id = serverId;
    saveAllMessages(all);
  }
  return messages;
}

/**
 * Mark all messages in a conversation as read.
 */
export function markMessagesAsRead(conversationId, readerId = null) {
  const all = loadAllMessages();
  const messages = all[conversationId] || [];
  let changed = false;

  for (const msg of messages) {
    if (msg.status !== 'read') {
      msg.status = 'read';
      changed = true;
    }
  }

  if (changed) {
    saveAllMessages(all);
  }
  return messages;
}

/**
 * Delete a specific message locally.
 */
export function deleteMessage(conversationId, messageId) {
  const all = loadAllMessages();
  if (all[conversationId]) {
    all[conversationId] = all[conversationId].filter(m => m.id !== messageId);
    saveAllMessages(all);
  }
  return all[conversationId] || [];
}

/**
 * Get all conversations with their latest message.
 */
export function getConversationPreviews() {
  const all = loadAllMessages();
  const previews = [];

  for (const [id, messages] of Object.entries(all)) {
    if (messages.length > 0) {
      const latest = messages[messages.length - 1];
      previews.push({
        conversationId: id,
        latestMessage: latest.text,
        latestTimestamp: latest.timestamp,
        unread: messages.filter(m => m.status !== 'read' && m.senderId !== 'self').length,
      });
    }
  }

  return previews.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
}

/**
 * Purge expired disappearing messages immediately.
 */
export function purgeExpiredMessages() {
  loadAllMessages(); // loadAllMessages automatically purges
}

/**
 * Clear all messages for a conversation.
 */
export function clearConversation(conversationId) {
  const all = loadAllMessages();
  delete all[conversationId];
  saveAllMessages(all);
}

/**
 * Clear ALL local message data.
 */
export function clearAllMessages() {
  localStorage.removeItem(MESSAGES_KEY);
  localStorage.removeItem(SEEN_NONCES_KEY);
}

