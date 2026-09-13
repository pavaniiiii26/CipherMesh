/**
 * CipherMesh — Local Contacts Store
 *
 * Contacts are stored CLIENT-SIDE ONLY in localStorage.
 * The server never has a contact list — it only provides a public key
 * lookup service for QR-scanned user IDs.
 *
 * Each contact: { user_id, public_key, display_name, online, addedAt }
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

export function addContact(contact) {
  const contacts = loadContacts();
  const existing = contacts.findIndex(c => c.user_id === contact.user_id);

  const entry = {
    user_id: contact.user_id,
    public_key: contact.public_key,
    display_name: contact.display_name || `User-${contact.user_id.substring(0, 6)}`,
    online: false,
    addedAt: Date.now(),
  };

  if (existing >= 0) {
    // Update existing contact
    contacts[existing] = { ...contacts[existing], ...entry };
  } else {
    contacts.push(entry);
  }

  saveContacts(contacts);
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
