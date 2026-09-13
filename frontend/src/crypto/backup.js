/**
 * CipherMesh — Encrypted Identity Backup & Recovery
 *
 * Provides password-protected cryptographic export and import of user identities
 * and contacts so users never lose their identity when clearing browser storage.
 *
 * Uses modern WebCrypto API:
 *   - Key Derivation: PBKDF2 with SHA-256, 100,000 iterations + 16-byte random salt
 *   - Authenticated Encryption: AES-GCM 256-bit with 12-byte random IV
 */

import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import { getIdentity } from './keys';
import { getContacts } from '../store/contacts';

const BACKUP_VERSION = 1;

/**
 * Derives an AES-GCM CryptoKey from a user passphrase and salt using PBKDF2.
 */
async function deriveKeyFromPassphrase(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Export identity and contacts as an encrypted JSON backup.
 * @param {string} passphrase - User's secret password
 * @returns {Promise<string>} JSON string of the encrypted backup file
 */
export async function exportEncryptedIdentity(passphrase) {
  if (!passphrase || passphrase.length < 6) {
    throw new Error('Passphrase must be at least 6 characters long');
  }

  const identity = getIdentity();
  if (!identity) {
    throw new Error('No identity found to export');
  }

  const contacts = getContacts();
  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem('ciphermesh_settings') || '{}');
  } catch {
    // ignore
  }

  const payload = JSON.stringify({
    identity,
    contacts,
    settings,
    exportedAt: Date.now(),
  });

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const enc = new TextEncoder();
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(payload)
  );

  const backupPackage = {
    ciphermesh_backup: true,
    version: BACKUP_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: 100000,
    cipher: 'AES-256-GCM',
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(ciphertextBuffer)),
    exportedAt: Date.now(),
  };

  return JSON.stringify(backupPackage, null, 2);
}

/**
 * Decrypt and restore an identity from an encrypted backup string.
 * @param {string} backupJsonString - JSON string of the backup file
 * @param {string} passphrase - User's secret password
 * @returns {Promise<{ identity: object, contacts: object[] }>}
 */
export async function importEncryptedIdentity(backupJsonString, passphrase) {
  let pkg;
  try {
    pkg = JSON.parse(backupJsonString);
  } catch {
    throw new Error('Invalid backup file format (not valid JSON)');
  }

  if (!pkg.ciphermesh_backup || !pkg.ciphertext || !pkg.salt || !pkg.iv) {
    throw new Error('Unrecognized backup format. Missing required cryptographic fields.');
  }

  const salt = decodeBase64(pkg.salt);
  const iv = decodeBase64(pkg.iv);
  const ciphertext = decodeBase64(pkg.ciphertext);

  let key;
  try {
    key = await deriveKeyFromPassphrase(passphrase, salt);
  } catch (err) {
    throw new Error('Key derivation failed: ' + err.message);
  }

  let decryptedBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error('Decryption failed. Incorrect passphrase or corrupted backup file.');
  }

  const dec = new TextDecoder();
  const data = JSON.parse(dec.decode(decryptedBuffer));

  if (!data.identity || !data.identity.userId || !data.identity.secretKey) {
    throw new Error('Backup package does not contain valid identity credentials');
  }

  // Restore into localStorage
  localStorage.setItem('ciphermesh_identity', JSON.stringify(data.identity));
  if (data.contacts && Array.isArray(data.contacts)) {
    localStorage.setItem('ciphermesh_contacts', JSON.stringify(data.contacts));
  }
  if (data.settings) {
    localStorage.setItem('ciphermesh_settings', JSON.stringify(data.settings));
  }

  return data;
}
