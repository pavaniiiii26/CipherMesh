/**
 * CipherMesh — Local Contacts Store
 *
 * Contacts are stored CLIENT-SIDE ONLY in localStorage.
 * The server never has a contact list.
 *
 * Each contact:
 * {
 *   user_id: string,
 *   public_key: string,
 *   signing_public_key?: string,
 *   display_name: string,
 *   online: boolean,
 *   addedAt: number,
 *   source: 'qr_scan' | 'manual_id' | 'group' | 'import',
 *   verified: boolean,
 *   verifiedAt?: number,
 *   keyChanged?: boolean
 * }
 */

const CONTACTS_KEY = 'ciphermesh_contacts';

function loadContacts() {
  try {
    const stored = localStorage.getItem(CONTACTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveContacts(contacts) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

export function getContacts() {
  return loadContacts();
}

/**
 * Add or update a contact with source metadata and key tampering protection.
 */
export function addContact(contact, source = 'manual_id') {
  const contacts = loadContacts();
  const existingIdx = contacts.findIndex(c => c.user_id === contact.user_id);

  if (existingIdx >= 0) {
    const existing = contacts[existingIdx];
    // Check if public key was altered (possible MITM key replacement)
    const keyChanged = existing.public_key && existing.public_key !== contact.public_key;

    contacts[existingIdx] = {
      ...existing,
      public_key: contact.public_key,
      signing_public_key: contact.signing_public_key || existing.signing_public_key,
      display_name: contact.display_name || existing.display_name,
      // If the public key changed, revoke verified status for security!
      verified: keyChanged ? false : (contact.verified ?? existing.verified ?? false),
      verifiedAt: keyChanged ? null : (contact.verifiedAt || existing.verifiedAt),
      keyChanged: keyChanged || existing.keyChanged,
    };
  } else {
    contacts.push({
      user_id: contact.user_id,
      public_key: contact.public_key,
      signing_public_key: contact.signing_public_key || null,
      display_name: contact.display_name || `User-${contact.user_id.substring(0, 6)}`,
      online: false,
      addedAt: contact.addedAt || Date.now(),
      source: contact.source || source,
      verified: contact.verified || false,
      verifiedAt: contact.verifiedAt || null,
      keyChanged: false,
    });
  }

  saveContacts(contacts);
  return contacts;
}

/**
 * Set verification status for a contact (Safety Numbers confirmed).
 */
export function verifyContact(userId, verified = true) {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.user_id === userId);
  if (contact) {
    contact.verified = verified;
    contact.verifiedAt = verified ? Date.now() : null;
    contact.keyChanged = false;
    saveContacts(contacts);
  }
  return contacts;
}

export function removeContact(userId) {
  const contacts = loadContacts().filter(c => c.user_id !== userId);
  saveContacts(contacts);
  return contacts;
}

export function updateContactPresence(userId, online) {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.user_id === userId);
  if (contact) {
    contact.online = online;
    saveContacts(contacts);
  }
  return contacts;
}

export function updateBatchPresence(presenceMap) {
  const contacts = loadContacts();
  let changed = false;
  for (const [userId, status] of Object.entries(presenceMap)) {
    const contact = contacts.find(c => c.user_id === userId);
    if (contact) {
      contact.online = status === 'online';
      changed = true;
    }
  }
  if (changed) {
    saveContacts(contacts);
  }
  return contacts;
}

export function getContact(userId) {
  return loadContacts().find(c => c.user_id === userId) || null;
}

