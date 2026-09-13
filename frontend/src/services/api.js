/**
 * CipherMesh — REST API Client
 *
 * Thin wrapper around fetch for all backend REST endpoints.
 * All message payloads sent through these endpoints are already encrypted
 * by the crypto layer — this module just handles HTTP transport.
 */

const API_BASE = 'http://localhost:8000/api';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Network error — server may be offline');
    }
    throw err;
  }
}

// ─── User Endpoints ───────────────────────────────────────────────

export async function registerUser(userId, publicKey, displayName, signingPublicKey = null) {
  return request('/users/register', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      public_key: publicKey,
      display_name: displayName,
      signing_public_key: signingPublicKey,
    }),
  });
}

export async function getUser(userId) {
  return request(`/users/${userId}`);
}

export async function getUserPresence(userId) {
  return request(`/users/${userId}/presence`);
}

// ─── Contact Endpoints ────────────────────────────────────────────

export async function resolveContact(userId) {
  return request('/contacts/resolve', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

// ─── Group Endpoints ──────────────────────────────────────────────

export async function createGroup(name, createdBy) {
  return request('/groups', {
    method: 'POST',
    body: JSON.stringify({ name, created_by: createdBy }),
  });
}

export async function getGroup(groupId) {
  return request(`/groups/${groupId}`);
}

export async function addGroupMember(groupId, userId, encryptedGroupKey, nonce) {
  return request(`/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      encrypted_group_key: encryptedGroupKey,
      nonce,
    }),
  });
}

export async function removeGroupMember(groupId, userId) {
  return request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
}

export async function getUserGroups(userId) {
  return request(`/groups/user/${userId}`);
}

// ─── Message Endpoints (Polling Fallback) ─────────────────────────

export async function getPendingMessages(userId) {
  return request(`/messages/${userId}/pending`);
}

export async function acknowledgeMessages(userId, messageIds) {
  return request(`/messages/${userId}/ack`, {
    method: 'POST',
    body: JSON.stringify({ message_ids: messageIds }),
  });
}

// ─── Health ──────────────────────────────────────────────────────

export async function healthCheck() {
  return request('/health');
}

// ─── Stats (Crypto Dashboard) ────────────────────────────────────

export async function getRelayStats() {
  return request('/stats');
}
