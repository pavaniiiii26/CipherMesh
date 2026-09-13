/**
 * CipherMesh — Simplified Double Ratchet Protocol
 *
 * Implements a simplified version of the Signal Double Ratchet:
 *   - Symmetric-key ratchet: chain key -> message key (per message)
 *   - DH ratchet: new ephemeral X25519 keypair when receiving from a new key
 *   - Root key: updated during DH ratchet steps
 *
 * State per conversation (serialized to localStorage):
 *   - rootKey: 32 bytes (current root key)
 *   - sendChainKey: 32 bytes (sending chain key)
 *   - sendCount: number (messages sent on current chain)
 *   - recvChainKey: 32 bytes (receiving chain key, may be null)
 *   - recvCount: number (messages received on current chain)
 *   - lastRemotePubKey: base64 (last seen remote ephemeral public key)
 *   - localKeyPair: { publicKey, secretKey } (current local ratchet keypair)
 *
 * PRODUCTION NOTES:
 *   - This is a simplified implementation for demonstration.
 *   - Production would need:
 *     • Skipped message keys (out-of-order message handling)
 *     • Proper key ratchet period limits
 *     • Key compromise detection
 *     • Persistent storage with key rotation policies
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

const RATCHET_STORAGE_KEY = 'ciphermesh_ratchet_state';

// ─── HKDF-like Key Derivation ─────────────────────────────────────

/**
 * Derive (nextChainKey, messageKey) from current chain key using HMAC-SHA256.
 * Chain step: CK_{n+1} = HMAC-SHA256(CK_n, 0x01), MK_n = HMAC-SHA256(CK_n, 0x02)
 */
function chainStep(chainKey) {
  const zeroByte = new Uint8Array([0x01]);
  const msgByte = new Uint8Array([0x02]);
  const nextChainKey = nacl.hash(
    new Uint8Array([...chainKey, ...zeroByte])
  ).slice(0, 32);
  const messageKey = nacl.hash(
    new Uint8Array([...chainKey, ...msgByte])
  ).slice(0, 32);
  return { nextChainKey, messageKey };
}

/**
 * KDF for root key update during DH ratchet.
 * RK_{n+1}, CK_{n+1} = HKDF(RK_n, DH_output)
 */
function rootKDF(rootKey, dhOutput) {
  const input = new Uint8Array([...rootKey, ...dhOutput]);
  const hash1 = nacl.hash(input).slice(0, 32);

  const saltByte = new Uint8Array([0x01]);
  const hash2 = nacl.hash(new Uint8Array([...hash1, ...saltByte])).slice(0, 32);

  return { newRootKey: hash1, chainKey: hash2 };
}

// ─── State Management ──────────────────────────────────────────────

/**
 * Get ratchet state for a conversation. Returns null if not initialized.
 */
export function getRatchetState(conversationId) {
  try {
    const all = JSON.parse(localStorage.getItem(RATCHET_STORAGE_KEY) || '{}');
    const state = all[conversationId];
    if (!state) return null;
    return {
      ...state,
      rootKey: decodeBase64(state.rootKey),
      sendChainKey: state.sendChainKey ? decodeBase64(state.sendChainKey) : null,
      recvChainKey: state.recvChainKey ? decodeBase64(state.recvChainKey) : null,
      localKeyPair: state.localKeyPair ? {
        publicKey: decodeBase64(state.localKeyPair.publicKey),
        secretKey: decodeBase64(state.localKeyPair.secretKey),
      } : null,
    };
  } catch {
    return null;
  }
}

/**
 * Save ratchet state for a conversation.
 */
function saveRatchetState(conversationId, state) {
  const all = JSON.parse(localStorage.getItem(RATCHET_STORAGE_KEY) || '{}');
  all[conversationId] = {
    rootKey: encodeBase64(state.rootKey),
    sendChainKey: state.sendChainKey ? encodeBase64(state.sendChainKey) : null,
    sendCount: state.sendCount || 0,
    recvChainKey: state.recvChainKey ? encodeBase64(state.recvChainKey) : null,
    recvCount: state.recvCount || 0,
    lastRemotePubKey: state.lastRemotePubKey || null,
    localKeyPair: state.localKeyPair ? {
      publicKey: encodeBase64(state.localKeyPair.publicKey),
      secretKey: encodeBase64(state.localKeyPair.secretKey),
    } : null,
    initialized: state.initialized || false,
    messageCount: (state.messageCount || 0) + 1,
    lastRatchetAt: Date.now(),
  };
  localStorage.setItem(RATCHET_STORAGE_KEY, JSON.stringify(all));
}

/**
 * Initialize ratchet state for a conversation (called on first message or key exchange).
 */
export function initRatchetState(conversationId, recipientPublicKeyB64) {
  const existing = getRatchetState(conversationId);
  if (existing && existing.initialized) return existing;

  const localPair = nacl.box.keyPair();
  const recipientPubKey = decodeBase64(recipientPublicKeyB64);

  // Compute initial shared secret via DH
  const dhOutput = nacl.box.before(recipientPubKey, localPair.secretKey);

  // Derive initial root key and send chain
  const initialRootKey = new Uint8Array(32);
  initialRootKey.fill(0);
  const { newRootKey, chainKey } = rootKDF(initialRootKey, dhOutput);

  const state = {
    rootKey: newRootKey,
    sendChainKey: chainKey,
    sendCount: 0,
    recvChainKey: null,
    recvCount: 0,
    lastRemotePubKey: recipientPublicKeyB64,
    localKeyPair: localPair,
    initialized: true,
    messageCount: 0,
  };

  saveRatchetState(conversationId, state);
  return state;
}

// ─── Ratchet Operations ────────────────────────────────────────────

/**
 * Perform a DH ratchet step when receiving from a new remote public key.
 * Advances the root key and creates a new receiving chain.
 */
function dhRatchet(state, remotePubKeyB64) {
  const remotePubKey = decodeBase64(remotePubKeyB64);
  const newLocalPair = nacl.box.keyPair();

  // DH with new local key + remote key
  const dhOutput1 = nacl.box.before(remotePubKey, newLocalPair.secretKey);

  // Skip message: advance root key and create receiving chain
  const { newRootKey: rk1, chainKey: recvChain } = rootKDF(state.rootKey, dhOutput1);

  // If we already had a send chain, do a second DH ratchet to create new send chain
  let finalRootKey = rk1;
  let newSendChain = null;
  if (state.localKeyPair) {
    const dhOutput2 = nacl.box.before(remotePubKey, state.localKeyPair.secretKey);
    const { newRootKey: rk2, chainKey: sendChain } = rootKDF(rk1, dhOutput2);
    finalRootKey = rk2;
    newSendChain = sendChain;
  }

  return {
    ...state,
    rootKey: finalRootKey,
    sendChainKey: newSendChain || state.sendChainKey,
    sendCount: newSendChain ? 0 : state.sendCount,
    recvChainKey: recvChain,
    recvCount: 0,
    lastRemotePubKey: remotePubKeyB64,
    localKeyPair: newLocalPair,
  };
}

/**
 * Symmetric ratchet step: derive next message key from sending chain.
 */
function symmetricRatchetStep(state) {
  if (!state.sendChainKey) return { messageKey: null, state };

  const { nextChainKey, messageKey } = chainStep(state.sendChainKey);
  return {
    messageKey,
    state: {
      ...state,
      sendChainKey: nextChainKey,
      sendCount: (state.sendCount || 0) + 1,
    },
  };
}

/**
 * Advance the receiving chain to derive the next message key.
 */
function advanceRecvChain(state) {
  if (!state.recvChainKey) return { messageKey: null, state };

  const { nextChainKey, messageKey } = chainStep(state.recvChainKey);
  return {
    messageKey,
    state: {
      ...state,
      recvChainKey: nextChainKey,
      recvCount: (state.recvCount || 0) + 1,
    },
  };
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Encrypt a message using the Double Ratchet protocol.
 *
 * @param {string} plaintext - Message to encrypt
 * @param {string} conversationId - Conversation identifier
 * @param {string} recipientPublicKeyB64 - Recipient's static public key (for DH ratchet)
 * @returns {{ encrypted: string, nonce: string, dr_ephemeral: string, dr_message_number: number }}
 */
export function ratchetEncrypt(plaintext, conversationId, recipientPublicKeyB64) {
  let state = getRatchetState(conversationId);
  if (!state || !state.initialized) {
    state = initRatchetState(conversationId, recipientPublicKeyB64);
  }

  // Get message key from sending chain
  const { messageKey, state: newState } = symmetricRatchetStep(state);
  if (!messageKey) {
    throw new Error('Ratchet not properly initialized — no send chain');
  }

  // Encrypt with message key
  const recipientPubKey = decodeBase64(recipientPublicKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(plaintext);

  const encrypted = nacl.box(messageBytes, nonce, recipientPubKey, messageKey);

  // Save state
  saveRatchetState(conversationId, newState);

  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
    dr_ephemeral: encodeBase64(newState.localKeyPair.publicKey),
    dr_message_number: newState.sendCount - 1,
    dr_flag: true, // Flag that this is a Double Ratchet message
  };
}

/**
 * Decrypt a message using the Double Ratchet protocol.
 *
 * @param {string} encryptedB64 - Encrypted payload (base64)
 * @param {string} nonceB64 - Nonce (base64)
 * @param {string} senderEphemeralB64 - Sender's ephemeral public key (base64)
 * @param {string} conversationId - Conversation identifier
 * @param {string} recipientSecretKeyB64 - This user's static secret key (for DH ratchet fallback)
 * @returns {string|null} Decrypted plaintext, or null on failure
 */
export function ratchetDecrypt(encryptedB64, nonceB64, senderEphemeralB64, conversationId, recipientSecretKeyB64) {
  let state = getRatchetState(conversationId);

  if (!state || !state.initialized) {
    // Initialize with sender's ephemeral key
    state = initRatchetState(conversationId, senderEphemeralB64);
  }

  // Check if we need a DH ratchet (new remote key)
  if (senderEphemeralB64 !== state.lastRemotePubKey) {
    state = dhRatchet(state, senderEphemeralB64);
  }

  // Try receiving chain first
  if (state.recvChainKey) {
    const { messageKey, state: advancedState } = advanceRecvChain(state);

    if (messageKey) {
      const encrypted = decodeBase64(encryptedB64);
      const nonce = decodeBase64(nonceB64);

      const decrypted = nacl.box.open(encrypted, nonce, decodeBase64(senderEphemeralB64), messageKey);
      if (decrypted) {
        saveRatchetState(conversationId, advancedState);
        return new TextDecoder().decode(decrypted);
      }
    }
  }

  // Fallback: try with static key decryption (backward compatibility)
  if (recipientSecretKeyB64) {
    try {
      const encrypted = decodeBase64(encryptedB64);
      const nonce = decodeBase64(nonceB64);
      const senderPubKey = decodeBase64(senderEphemeralB64);
      const recipientSecKey = decodeBase64(recipientSecretKeyB64);

      const decrypted = nacl.box.open(encrypted, nonce, senderPubKey, recipientSecKey);
      if (decrypted) {
        return new TextDecoder().decode(decrypted);
      }
    } catch {
      // ignore fallback failure
    }
  }

  return null;
}

/**
 * Get ratchet statistics for the crypto dashboard.
 */
export function getRatchetStats() {
  try {
    const all = JSON.parse(localStorage.getItem(RATCHET_STORAGE_KEY) || '{}');
    const conversations = Object.keys(all);
    let totalMessages = 0;
    let activeChains = 0;

    for (const [, state] of Object.entries(all)) {
      totalMessages += state.messageCount || 0;
      if (state.sendChainKey || state.recvChainKey) {
        activeChains++;
      }
    }

    return {
      activeSessions: conversations.length,
      activeChains,
      totalRatchetedMessages: totalMessages,
      conversations: conversations.map(id => ({
        id,
        sendCount: all[id].sendCount || 0,
        recvCount: all[id].recvCount || 0,
        totalMessages: all[id].messageCount || 0,
        lastRatchetAt: all[id].lastRatchetAt || null,
        initialized: all[id].initialized || false,
      })),
    };
  } catch {
    return { activeSessions: 0, activeChains: 0, totalRatchetedMessages: 0, conversations: [] };
  }
}

/**
 * Check if a conversation has ratchet state initialized.
 */
export function hasRatchetState(conversationId) {
  const state = getRatchetState(conversationId);
  return state && state.initialized;
}

/**
 * Clear all ratchet state (for identity wipe).
 */
export function clearAllRatchetState() {
  localStorage.removeItem(RATCHET_STORAGE_KEY);
}
