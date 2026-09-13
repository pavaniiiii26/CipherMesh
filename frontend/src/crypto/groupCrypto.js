/**
 * CipherMesh — Group Encryption (Sender-Keys Scheme)
 *
 * Simple symmetric-key scheme for group chats:
 *   1. Group creator generates a random 256-bit group key
 *   2. Group key is encrypted individually for each member using nacl.box
 *   3. Messages are encrypted with nacl.secretbox using the shared group key
 *
 * PRODUCTION NOTES:
 *   - This is a SIMPLIFIED sender-keys scheme. It does NOT provide:
 *     • Forward secrecy (compromised group key decrypts all past messages)
 *     • Post-compromise security
 *     • Proper key rotation on member removal
 *   - For production, implement the Messaging Layer Security (MLS) protocol
 *     (RFC 9420) which provides all of the above via tree-based key agreement.
 *   - On member removal, the group key MUST be rotated. This prototype
 *     does not enforce that.
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

/**
 * Generate a random 256-bit symmetric key for group encryption.
 * @returns {string} Base64-encoded group key
 */
export function generateGroupKey() {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  return encodeBase64(key);
}

/**
 * Encrypt the group key for a specific member using nacl.box.
 * This allows securely distributing the group key to each member individually.
 *
 * @param {string} groupKeyB64 - The group symmetric key (base64)
 * @param {string} recipientPublicKeyB64 - Member's public key (base64)
 * @param {string} senderSecretKeyB64 - Sender's (admin's) secret key (base64)
 * @returns {{ encrypted: string, nonce: string }}
 */
export function encryptGroupKey(groupKeyB64, recipientPublicKeyB64, senderSecretKeyB64) {
  const groupKeyBytes = decodeBase64(groupKeyB64);
  const recipientPubKey = decodeBase64(recipientPublicKeyB64);
  const senderSecKey = decodeBase64(senderSecretKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const encrypted = nacl.box(groupKeyBytes, nonce, recipientPubKey, senderSecKey);

  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

/**
 * Decrypt a group key that was encrypted for this member.
 *
 * @param {string} encryptedKeyB64 - Encrypted group key (base64)
 * @param {string} nonceB64 - Nonce (base64)
 * @param {string} senderPublicKeyB64 - Admin's public key who encrypted (base64)
 * @param {string} recipientSecretKeyB64 - This member's secret key (base64)
 * @returns {string|null} Base64-encoded group key, or null on failure
 */
export function decryptGroupKey(encryptedKeyB64, nonceB64, senderPublicKeyB64, recipientSecretKeyB64) {
  try {
    const encrypted = decodeBase64(encryptedKeyB64);
    const nonce = decodeBase64(nonceB64);
    const senderPubKey = decodeBase64(senderPublicKeyB64);
    const recipientSecKey = decodeBase64(recipientSecretKeyB64);

    const groupKeyBytes = nacl.box.open(encrypted, nonce, senderPubKey, recipientSecKey);
    if (!groupKeyBytes) return null;

    return encodeBase64(groupKeyBytes);
  } catch (err) {
    console.error('Failed to decrypt group key:', err);
    return null;
  }
}

/**
 * Encrypt a message with the group's symmetric key using nacl.secretbox.
 * All group members with the key can decrypt this.
 *
 * @param {string} plaintext - Message to encrypt
 * @param {string} groupKeyB64 - Group symmetric key (base64)
 * @returns {{ encrypted: string, nonce: string }}
 */
export function encryptGroupMessage(plaintext, groupKeyB64) {
  const key = decodeBase64(groupKeyB64);
  const messageBytes = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);

  const encrypted = nacl.secretbox(messageBytes, nonce, key);

  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

/**
 * Decrypt a group message using the shared symmetric key.
 *
 * @param {string} encryptedB64 - Encrypted message (base64)
 * @param {string} nonceB64 - Nonce (base64)
 * @param {string} groupKeyB64 - Group symmetric key (base64)
 * @returns {string|null} Decrypted plaintext, or null on failure
 */
export function decryptGroupMessage(encryptedB64, nonceB64, groupKeyB64) {
  try {
    const encrypted = decodeBase64(encryptedB64);
    const nonce = decodeBase64(nonceB64);
    const key = decodeBase64(groupKeyB64);

    const decrypted = nacl.secretbox.open(encrypted, nonce, key);
    if (!decrypted) {
      console.warn('Group message decryption failed');
      return null;
    }

    return encodeUTF8(decrypted);
  } catch (err) {
    console.error('Group decryption error:', err);
    return null;
  }
}
