import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';
import { resolveContact } from '../services/api';
import {
  getContacts,
  addContact as addContactLocal,
  removeContact as removeContactLocal,
} from '../store/contacts';
import ContactItem from '../components/ContactItem';
import wsManager from '../services/websocket';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState(null);
  const [addLoading, setAddLoading] = useState(false);
  const navigate = useNavigate();
  const identity = getIdentity();

  const refreshContacts = useCallback(() => {
    setContacts(getContacts());
  }, []);

  useEffect(() => {
    refreshContacts();

    // Subscribe to presence updates
    const unsub1 = wsManager.on('presence', (data) => {
      const updated = getContacts().map(c =>
        c.user_id === data.user_id ? { ...c, online: data.status === 'online' } : c
      );
      setContacts(updated);
    });

    const unsub2 = wsManager.on('presence_batch', (data) => {
      const updated = getContacts().map(c => ({
        ...c,
        online: data.states[c.user_id] === 'online',
      }));
      setContacts(updated);
    });

    // Request presence for all contacts
    const contactIds = getContacts().map(c => c.user_id);
    if (contactIds.length > 0) {
      wsManager.subscribePresence(contactIds);
    }

    return () => {
      unsub1();
      unsub2();
    };
  }, [refreshContacts]);

  const handleAddContact = async () => {
    setAddError(null);
    setAddLoading(true);

    try {
      let contactData;

      // Try to parse as JSON (from QR scan)
      try {
        contactData = JSON.parse(addInput);
      } catch {
        // If not JSON, treat as a user_id and resolve from server
        contactData = await resolveContact(addInput.trim());
      }

      if (!contactData.user_id || !contactData.public_key) {
        throw new Error('Invalid contact data — needs user_id and public_key');
      }

      if (contactData.user_id === identity?.userId) {
        throw new Error("That's your own ID!");
      }

      addContactLocal(contactData);
      refreshContacts();
      setShowAdd(false);
      setAddInput('');

      // Subscribe to new contact's presence
      wsManager.subscribePresence([contactData.user_id]);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemoveContact = (userId) => {
    if (confirm('Remove this contact? Chat history will be preserved.')) {
      removeContactLocal(userId);
      refreshContacts();
    }
  };

  const handleContactClick = (contact) => {
    navigate(`/chat/${contact.user_id}`);
  };

  return (
    <div className="page contacts-page">
      <div className="page-header">
        <h1>Contacts</h1>
        <button className="btn btn-accent" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? '✕ Cancel' : '+ Add Contact'}
        </button>
      </div>

      {showAdd && (
        <div className="add-contact-panel glass-panel">
          <h3>Add a Contact</h3>
          <p className="subtitle">
            Paste a contact&apos;s JSON payload (from QR scan) or enter their User ID
          </p>
          <div className="input-group">
            <textarea
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              placeholder='{"user_id": "...", "public_key": "...", "display_name": "..."} or just a user ID'
              rows={3}
            />
          </div>
          {addError && <div className="error-message">{addError}</div>}
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={handleAddContact}
              disabled={!addInput.trim() || addLoading}
            >
              {addLoading ? 'Resolving...' : 'Add Contact'}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/qr')}>
              📸 Scan QR Instead
            </button>
          </div>
        </div>
      )}

      <div className="contacts-list">
        {contacts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👥</div>
            <h3>No contacts yet</h3>
            <p>Add a contact by scanning their QR code or pasting their ID</p>
            <button className="btn btn-accent" onClick={() => setShowAdd(true)}>
              + Add Your First Contact
            </button>
          </div>
        ) : (
          contacts.map(contact => (
            <div key={contact.user_id} className="contact-row">
              <ContactItem
                contact={contact}
                onClick={handleContactClick}
              />
              <button
                className="btn-icon delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveContact(contact.user_id);
                }}
                title="Remove contact"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
