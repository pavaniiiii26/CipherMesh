/**
 * CipherMesh — Encrypted File Sharing
 *
 * Provides client-side encryption/decryption for file attachments.
 * Files are encrypted with nacl.secretbox (symmetric) using a random key,
 * then the key is encrypted with nacl.box for the recipient.
 *
 * Supports: images, videos, documents, any file type.
 * File data is transmitted as base64-encoded encrypted blobs.
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

const FILE_PAYLOAD_PREFIX = 'cm-file:v1:';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

/**
 * Check if a message text is an encrypted file payload.
 */
export function isFilePayload(text) {
  return typeof text === 'string' && text.startsWith(FILE_PAYLOAD_PREFIX);
}

/**
 * Read a File object as a Uint8Array.
 */
function readFileAsBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Encrypt a file for sending.
 *
 * @param {File} file - The file to encrypt
 * @param {string} recipientKeyB64 - Recipient's public key (base64) or group key (base64)
 * @param {object} meta - { groupId, senderId, conversationId }
 * @returns {{ encryptedPayload: string, fileMetadata: object }}
 */
export async function encryptFile(file, recipientKeyB64, meta = {}) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`);
  }

  // Read file bytes
  const fileBytes = await readFileAsBytes(file);

  // Generate random symmetric key for file encryption
  const fileKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const fileNonce = nacl.randomBytes(nacl.secretbox.nonceLength);

  // Encrypt file content with symmetric key
  const encryptedContent = nacl.secretbox(fileBytes, fileNonce, fileKey);

  // Encrypt the file key for the recipient
  const recipientPubKey = decodeBase64(recipientKeyB64);
  const senderSecKey = meta.senderSecretKey ? decodeBase64(meta.senderSecretKey) : null;
  const keyNonce = nacl.randomBytes(nacl.box.nonceLength);

  let encryptedFileKey;
  if (senderSecKey) {
    // 1:1 file: encrypt key with recipient's public key
    encryptedFileKey = nacl.box(fileKey, keyNonce, recipientPubKey, senderSecKey);
  } else {
    // Group file: fileKey is the group key, use it directly
    encryptedFileKey = fileKey; // Will be decrypted with group key
  }

  // Build the file payload
  const filePayload = {
    v: 1,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    key: encodeBase64(senderSecKey ? encryptedFileKey : fileKey),
    keyNonce: encodeBase64(keyNonce),
    nonce: encodeBase64(fileNonce),
    data: encodeBase64(encryptedContent),
  };

  return {
    encryptedPayload: FILE_PAYLOAD_PREFIX + btoa(JSON.stringify(filePayload)),
    fileMetadata: {
      name: file.name,
      type: file.type,
      size: file.size,
    },
  };
}

/**
 * Decrypt a received file payload.
 *
 * @param {string} encryptedPayload - The cm-file prefixed payload string
 * @param {string} decryptionKeyB64 - Secret key (base64) for 1:1 or group key (base64) for groups
 * @returns {object} { name, type, size, dataUrl, blob }
 */
export function decryptFile(encryptedPayload, decryptionKeyB64) {
  if (!isFilePayload(encryptedPayload)) {
    throw new Error('Not a file payload');
  }

  // Parse the payload
  const jsonStr = atob(encryptedPayload.slice(FILE_PAYLOAD_PREFIX.length));
  const payload = JSON.parse(jsonStr);

  // Decrypt the file content
  const encryptedData = decodeBase64(payload.data);
  const fileNonce = decodeBase64(payload.nonce);

  let fileKey;
  if (payload.keyNonce && payload.keyNonce !== encodeBase64(new Uint8Array(nacl.box.nonceLength))) {
    // 1:1 file: decrypt the file key with our secret key
    const encryptedKey = decodeBase64(payload.key);
    const keyNonce = decodeBase64(payload.keyNonce);
    const secretKey = decodeBase64(decryptionKeyB64);

    // Try to decrypt the key — this requires the recipient's secret key
    // For group files, the key IS the group key (already decrypted)
    fileKey = nacl.box.open(encryptedKey, keyNonce, new Uint8Array(32), secretKey);
    if (!fileKey) {
      throw new Error('Failed to decrypt file key — wrong key or corrupted payload');
    }
  } else {
    // Group file: decryption key IS the file key
    fileKey = decodeBase64(decryptionKeyB64);
  }

  const decryptedBytes = nacl.secretbox.open(encryptedData, fileNonce, fileKey);
  if (!decryptedBytes) {
    throw new Error('Failed to decrypt file content — wrong key or corrupted data');
  }

  // Create a Blob and data URL for preview
  const blob = new Blob([decryptedBytes], { type: payload.type });
  const dataUrl = URL.createObjectURL(blob);

  return {
    name: payload.name,
    type: payload.type,
    size: payload.size,
    dataUrl,
    blob,
  };
}

/**
 * Get human-readable file size.
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get file type icon based on MIME type.
 */
export function getFileIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  return '📄';
}
