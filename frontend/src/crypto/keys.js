/**
 * CipherMesh — Client-side Key Management & Encryption
 *
 * All cryptographic operations happen here, on the CLIENT. The server
 * never sees private keys or plaintext messages.
 *
 * Uses tweetnacl (NaCl) for:
 *   - X25519 Diffie-Hellman key exchange (nacl.box.keyPair)
 *   - Authenticated encryption (nacl.box / nacl.box.open)
 *   - Ed25519 digital signatures (nacl.sign) for message integrity
 *   - Ephemeral key negotiation for Forward Secrecy
 *   - Cryptographic Safety Numbers for MITM protection
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
 * Generate a new Ed25519 keypair for signing and message integrity.
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generateSigningKeyPair() {
  return nacl.sign.keyPair();
}

/**
 * Derive a user ID from an X25519 public key.
 * Uses the first 16 hex characters of a SHA-256 digest.
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
 * Compute a 60-digit Safety Number (fingerprint) between two parties.
 * Sorts keys lexicographically so both parties compute the exact same numbers.
 *
 * Formatted as 12 blocks of 5 decimal digits (Signal standard style).
 *
 * @param {string} pubKeyA - First user's public key (base64)
 * @param {string} pubKeyB - Second user's public key (base64)
 * @returns {Promise<{ formatted: string, blocks: string[], rawHex: string }>}
 */
export async function generateSafetyNumber(pubKeyA, pubKeyB) {
  if (!pubKeyA || !pubKeyB) {
    return { formatted: '00000-00000-00000', blocks: [], rawHex: '' };
  }

  // Lexicographical sort ensures symmetry regardless of who views the screen
  const [first, second] = [pubKeyA, pubKeyB].sort();
  const combined = decodeUTF8(`${first}:${second}`);

  // Multi-round SHA-256 for key derivation
  const digest1 = await crypto.subtle.digest('SHA-256', combined);
  const digest2 = await crypto.subtle.digest('SHA-256', digest1);
  const hashBytes = new Uint8Array(digest2);

  // Convert into 12 5-digit numeric blocks (60 digits total)
  const blocks = [];
  for (let i = 0; i < 12; i++) {
    // Take 2 bytes per block -> number between 0 and 65535, modulo 100000
    const val = ((hashBytes[(i * 2) % hashBytes.length] << 8) | hashBytes[(i * 2 + 1) % hashBytes.length]) % 100000;
    blocks.push(val.toString().padStart(5, '0'));
  }

  const rawHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const formatted = blocks.join(' ');

  return { formatted, blocks, rawHex };
}

/**
 * Load existing identity from localStorage, or create a new one.
 * Includes both X25519 (box) and Ed25519 (sign) keypairs.
 * Automatically migrates older identities to add signing keys if missing.
 */
export async function loadOrCreateIdentity(displayName = null) {
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);

  if (stored) {
    const identity = JSON.parse(stored);
    let changed = false;

    // Migrate: generate Ed25519 signing keys if missing from older sessions
    if (!identity.signingPublicKey || !identity.signingSecretKey) {
      const signKeyPair = generateSigningKeyPair();
      identity.signingPublicKey = encodeBase64(signKeyPair.publicKey);
      identity.signingSecretKey = encodeBase64(signKeyPair.secretKey);
      changed = true;
    }

    // Update display name if provided
    if (displayName && displayName !== identity.displayName) {
      identity.displayName = displayName;
      changed = true;
    }

    if (changed) {
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    }
    return identity;
  }

  // First launch — generate fresh keypairs
  const boxKeyPair = generateKeyPair();
  const signKeyPair = generateSigningKeyPair();
  const userId = await getUserId(boxKeyPair.publicKey);

  const identity = {
    userId,
    publicKey: encodeBase64(boxKeyPair.publicKey),
    secretKey: encodeBase64(boxKeyPair.secretKey),
    signingPublicKey: encodeBase64(signKeyPair.publicKey),
    signingSecretKey: encodeBase64(signKeyPair.secretKey),
    displayName: displayName || `User-${userId.substring(0, 6)}`,
    createdAt: Date.now()
  };

  localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

/**
 * Get current identity without creating one.
 * Returns null if not yet set up.
 */
export function getIdentity() {
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
  if (!stored) return null;
  try {
    const identity = JSON.parse(stored);
    // On-the-fly migration check
    if (!identity.signingPublicKey || !identity.signingSecretKey) {
      const signKeyPair = generateSigningKeyPair();
      identity.signingPublicKey = encodeBase64(signKeyPair.publicKey);
      identity.signingSecretKey = encodeBase64(signKeyPair.secretKey);
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    }
    return identity;
  } catch {
    return null;
  }
}

/**
 * Delete identity and all local data.
 */
export function deleteIdentity() {
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  localStorage.removeItem('ciphermesh_contacts');
  localStorage.removeItem('ciphermesh_messages');
  localStorage.removeItem('ciphermesh_settings');
  localStorage.removeItem('ciphermesh_group_keys');
}

/**
 * Encrypt a message with Forward Secrecy.
 *
 * Generates an ephemeral X25519 keypair for each message:
 *   - Sender computes shared secret from ephemeral secret + recipient static public key
 *   - Sender discards the ephemeral secret key immediately!
 *   - Even if sender's static private key is leaked later, past ciphertexts CANNOT be decrypted.
 *
 * @param {string} plaintext - The message to encrypt
 * @param {string} recipientPublicKeyB64 - Recipient's static public key (base64)
 * @returns {{ encrypted: string, nonce: string, ephemeralPublicKey: string }}
 */
export function encryptMessageWithForwardSecrecy(plaintext, recipientPublicKeyB64) {
  const recipientPubKey = decodeBase64(recipientPublicKeyB64);
  const ephemeralPair = nacl.box.keyPair();
  const messageBytes = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const encrypted = nacl.box(messageBytes, nonce, recipientPubKey, ephemeralPair.secretKey);

  if (!encrypted) {
    throw new Error('Encryption failed');
  }

  const result = {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
    ephemeralPublicKey: encodeBase64(ephemeralPair.publicKey)
  };

  // Explicitly wipe ephemeral secret key from memory
  ephemeralPair.secretKey.fill(0);

  return result;
}

/**
 * Decrypt a message with Forward Secrecy or fallback to static key.
 *
 * @param {string} encryptedB64 - Encrypted message (base64)
 * @param {string} nonceB64 - Nonce (base64)
 * @param {string} senderKeyB64 - Ephemeral public key (preferred) or sender's static public key
 * @param {string} recipientSecretKeyB64 - Recipient's static secret key (base64)
 * @returns {string|null} Decrypted plaintext, or null on failure
 */
export function decryptMessageWithForwardSecrecy(encryptedB64, nonceB64, senderKeyB64, recipientSecretKeyB64) {
  try {
    const encrypted = decodeBase64(encryptedB64);
    const nonce = decodeBase64(nonceB64);
    const senderPubKey = decodeBase64(senderKeyB64);
    const recipientSecKey = decodeBase64(recipientSecretKeyB64);

    const decrypted = nacl.box.open(encrypted, nonce, senderPubKey, recipientSecKey);

    if (!decrypted) {
      console.warn('Decryption failed — invalid key, corrupt nonce, or tampered payload');
      return null;
    }

    return encodeUTF8(decrypted);
  } catch (err) {
    console.error('Decryption error:', err);
    return null;
  }
}

/**
 * Standard nacl.box encrypt (backward compatible fallback).
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
 * Standard nacl.box decrypt (backward compatible fallback).
 */
export function decryptMessage(encryptedB64, nonceB64, senderPublicKeyB64, recipientSecretKeyB64) {
  return decryptMessageWithForwardSecrecy(encryptedB64, nonceB64, senderPublicKeyB64, recipientSecretKeyB64);
}

/**
 * Digitally sign a payload using an Ed25519 signing secret key.
 * @param {string} payloadString - Text or JSON payload to sign
 * @param {string} signingSecretKeyB64 - Ed25519 secret key (base64)
 * @returns {string} Detached signature in base64
 */
export function signPayload(payloadString, signingSecretKeyB64) {
  const messageBytes = decodeUTF8(payloadString);
  const secretKeyBytes = decodeBase64(signingSecretKeyB64);
  const signature = nacl.sign.detached(messageBytes, secretKeyBytes);
  return encodeBase64(signature);
}

/**
 * Verify an Ed25519 signature.
 * @param {string} payloadString - Text or JSON payload
 * @param {string} signatureB64 - Detached signature (base64)
 * @param {string} signingPublicKeyB64 - Sender's Ed25519 public key (base64)
 * @returns {boolean} True if signature is authentic
 */
export function verifySignature(payloadString, signatureB64, signingPublicKeyB64) {
  try {
    if (!payloadString || !signatureB64 || !signingPublicKeyB64) return false;
    const messageBytes = decodeUTF8(payloadString);
    const signatureBytes = decodeBase64(signatureB64);
    const publicKeyBytes = decodeBase64(signingPublicKeyB64);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

