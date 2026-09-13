/**
 * CipherMesh — Client-side Key Management & Encryption
 *
 * All cryptographic operations happen here, on the CLIENT. The server
 * never sees private keys or plaintext messages.
 *
 * Uses tweetnacl (NaCl) for:
 *   - X25519 Diffie-Hellman key exchange (nacl.box.keyPair)
 *   - Authenticated encryption (nacl.box / nacl.box.open)
 *
 * PRODUCTION NOTES:
 *   - Private keys are stored in localStorage for this prototype.
 *     A real app MUST use:
 *       • Web Crypto API with non-extractable CryptoKey objects
 *       • Or a secure enclave / hardware-backed keystore (on mobile)
 *       • Or a password-derived encryption wrapper around the stored key
 *   - The user_id derivation (SHA-256 fingerprint of public key) should
 *     be verified server-side during registration.
 *   - Consider implementing the Double Ratchet Algorithm (Signal Protocol)
 *     for forward secrecy in 1:1 chats.
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

const IDENTITY_STORAGE_KEY = 'ciphermesh_identity';

/**
 * Generate a new X25519 keypair for authenticated encryption.
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generateKeyPair() {
  return nacl.box.keyPair();
}

/**
 * Derive a user ID from a public key.
 * Uses a simple hash — first 16 hex chars of a SHA-256 digest.
 *
 * PRODUCTION: Use a proper fingerprint scheme (e.g., full SHA-256
 * displayed as safety numbers for verification).
 */
export async function getUserId(publicKey) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', publicKey);
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.substring(0, 16);
}

/**
 * Load existing identity from localStorage, or create a new one.
 * Returns { userId, publicKey (base64), secretKey (base64), displayName }
 */
export async function loadOrCreateIdentity(displayName = null) {
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);

  if (stored) {
    const identity = JSON.parse(stored);
    // Update display name if provided
    if (displayName && displayName !== identity.displayName) {
      identity.displayName = displayName;
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    }
    return identity;
  }

  // First launch — generate new keypair
  const keyPair = generateKeyPair();
  const userId = await getUserId(keyPair.publicKey);

  const identity = {
    userId,
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
    displayName: displayName || `User-${userId.substring(0, 6)}`,
    createdAt: Date.now()
  };

  // PRODUCTION: Encrypt secretKey with a user-provided passphrase before storing
  localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

/**
 * Get current identity without creating one.
 * Returns null if not yet set up.
 */
export function getIdentity() {
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
  return stored ? JSON.parse(stored) : null;
}

/**
 * Delete identity and all local data.
 * This is irreversible — the keypair is lost.
 */
export function deleteIdentity() {
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  localStorage.removeItem('ciphermesh_contacts');
  localStorage.removeItem('ciphermesh_messages');
  localStorage.removeItem('ciphermesh_settings');
}

/**
 * Encrypt a message for a specific recipient using nacl.box.
 *
 * nacl.box uses X25519 DH + XSalsa20-Poly1305:
 *   - Derives a shared secret from sender's secret key + recipient's public key
 *   - Encrypts with XSalsa20 stream cipher
 *   - Authenticates with Poly1305 MAC
 *
 * @param {string} plaintext - The message to encrypt
 * @param {string} recipientPublicKeyB64 - Recipient's public key (base64)
 * @param {string} senderSecretKeyB64 - Sender's secret key (base64)
 * @returns {{ encrypted: string, nonce: string }} Both base64-encoded
 */
export function encryptMessage(plaintext, recipientPublicKeyB64, senderSecretKeyB64) {
  const recipientPubKey = decodeBase64(recipientPublicKeyB64);
  const senderSecKey = decodeBase64(senderSecretKeyB64);
  const messageBytes = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const encrypted = nacl.box(messageBytes, nonce, recipientPubKey, senderSecKey);

  if (!encrypted) {
    throw new Error('Encryption failed');
  }

  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

/**
 * Decrypt a message from a specific sender using nacl.box.open.
 *
 * @param {string} encryptedB64 - Encrypted message (base64)
 * @param {string} nonceB64 - Nonce used for encryption (base64)
 * @param {string} senderPublicKeyB64 - Sender's public key (base64)
 * @param {string} recipientSecretKeyB64 - Recipient's secret key (base64)
 * @returns {string|null} Decrypted plaintext, or null if decryption fails
 */
export function decryptMessage(encryptedB64, nonceB64, senderPublicKeyB64, recipientSecretKeyB64) {
  try {
    const encrypted = decodeBase64(encryptedB64);
    const nonce = decodeBase64(nonceB64);
    const senderPubKey = decodeBase64(senderPublicKeyB64);
    const recipientSecKey = decodeBase64(recipientSecretKeyB64);

    const decrypted = nacl.box.open(encrypted, nonce, senderPubKey, recipientSecKey);

    if (!decrypted) {
      console.warn('Decryption failed — message may have been tampered with');
      return null;
    }

    return encodeUTF8(decrypted);
  } catch (err) {
    console.error('Decryption error:', err);
    return null;
  }
}
