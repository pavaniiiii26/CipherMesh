/**
 * CipherMesh — Local Message Store
 *
 * Decrypted messages are stored CLIENT-SIDE ONLY in localStorage.
 * The server only ever sees encrypted blobs.
 *
 * Messages are stored per-conversation (keyed by contact user_id or group_id).
 *
 * PRODUCTION NOTES:
 *   - Use IndexedDB instead of localStorage for better performance with
 *     large message histories.
 *   - Implement message expiration / auto-delete.
 *   - Add full-text search via a client-side search index.
 */

const MESSAGES_KEY = 'ciphermesh_messages';

function loadAllMessages() {
  try {
    const stored = localStorage.getItem(MESSAGES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveAllMessages(allMessages) {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(allMessages));
}

/**
 * Get messages for a conversation.
 * @param {string} conversationId - Contact user_id or group_id
 */
export function getMessages(conversationId) {
  const all = loadAllMessages();
  return all[conversationId] || [];
}

/**
 * Add a message to a conversation.
 * @param {string} conversationId - Contact user_id or group_id
 * @param {object} message - { id, senderId, text, timestamp, status, isGroup }
 */
export function addMessage(conversationId, message) {
  const all = loadAllMessages();
  if (!all[conversationId]) {
    all[conversationId] = [];
  }

  // Avoid duplicates by server message ID
  if (message.id && all[conversationId].some(m => m.id === message.id)) {
    return all[conversationId];
  }

  all[conversationId].push({
    id: message.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderId: message.senderId,
    text: message.text,
    timestamp: message.timestamp || Date.now() / 1000,
    status: message.status || 'sent', // 'sending' | 'sent' | 'delivered' | 'failed'
    isGroup: message.isGroup || false,
  });

  saveAllMessages(all);
  return all[conversationId];
}

/**
 * Update a message's status (e.g., from 'sending' to 'delivered').
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
 * Get all conversations with their latest message (for inbox view).
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
        unread: messages.filter(m => m.status === 'delivered' && m.senderId !== 'self').length,
      });
    }
  }

  return previews.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
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
}
