import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';
import { generateGroupKey, encryptGroupKey } from '../crypto/groupCrypto';
import { createGroup as createGroupApi, getUserGroups, addGroupMember as addGroupMemberApi } from '../services/api';
import { getContacts } from '../store/contacts';

/**
 * Groups Management Page
 *
 * PRODUCTION NOTES:
 *   - Simple Sender-Keys Scheme used for prototype:
 *     The group creator creates a random symmetric key, encrypts it individually
 *     with each member's public key (via nacl.box), and stores it on the relay.
 *   - In production, this should be replaced with Messaging Layer Security (MLS, RFC 9420)
 *     or the Signal Sesame/TreeKEM protocol for ratcheted forward secrecy and post-compromise security.
 */

const GROUP_KEYS_STORAGE = 'ciphermesh_group_keys';

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const navigate = useNavigate();
  const identity = getIdentity();
  const contacts = getContacts();

  const loadGroups = async () => {
    if (!identity) return;
    try {
      const res = await getUserGroups(identity.userId);
      setGroups(res.groups || []);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  };

  useEffect(() => {
    loadGroups();
  }, []);

  const toggleContactSelection = (userId) => {
    setSelectedContacts(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !identity) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Generate new symmetric group key
      const newGroupKey = generateGroupKey();

      // 2. Call backend to create group metadata
      const group = await createGroupApi(groupName.trim(), identity.userId);
      const groupId = group.group_id;

      // 3. Encrypt group key for self and store in localStorage
      const storedKeys = JSON.parse(localStorage.getItem(GROUP_KEYS_STORAGE) || '{}');
      storedKeys[groupId] = newGroupKey;
      localStorage.setItem(GROUP_KEYS_STORAGE, JSON.stringify(storedKeys));

      // Add self as member in backend
      const selfEnc = encryptGroupKey(newGroupKey, identity.publicKey, identity.secretKey);
      await addGroupMemberApi(groupId, identity.userId, selfEnc.encrypted, selfEnc.nonce);

      // 4. Encrypt group key individually for each selected contact & add them
      for (const contactId of selectedContacts) {
        const contact = contacts.find(c => c.user_id === contactId);
        if (contact && contact.public_key) {
          const encKey = encryptGroupKey(newGroupKey, contact.public_key, identity.secretKey);
          await addGroupMemberApi(groupId, contactId, encKey.encrypted, encKey.nonce);
        }
      }

      setGroupName('');
      setSelectedContacts([]);
      setShowCreate(false);
      await loadGroups();
    } catch (err) {
      setError(err.message || 'Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page groups-page">
      <div className="page-header">
        <div>
          <h1>Encrypted Groups</h1>
          <p className="subtitle">Sender-keys encrypted group messaging (MLS placeholder)</p>
        </div>
        <button className="btn btn-accent" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '✕ Cancel' : '+ New Group'}
        </button>
      </div>

      {showCreate && (
        <div className="create-group-panel glass-panel">
          <h3>Create Secure Group</h3>
          <div className="input-group">
            <label>Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="e.g. Cypherpunks Collective"
              maxLength={40}
            />
          </div>

          <div className="member-selection">
            <label>Add Members from Contacts</label>
            {contacts.length === 0 ? (
              <p className="subtitle">No contacts available. Add contacts first to invite them.</p>
            ) : (
              <div className="contacts-picker-list">
                {contacts.map(c => (
                  <label key={c.user_id} className="contact-picker-item">
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(c.user_id)}
                      onChange={() => toggleContactSelection(c.user_id)}
                    />
                    <span className="picker-name">{c.display_name}</span>
                    <span className="picker-id mono">{c.user_id.substring(0, 8)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || loading}
            >
              {loading ? 'Creating...' : 'Create & Distribute Keys'}
            </button>
          </div>
        </div>
      )}

      <div className="groups-list">
        {groups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🛡️</div>
            <h3>No groups joined</h3>
            <p>Create a group to start encrypted group communication</p>
          </div>
        ) : (
          groups.map(g => (
            <div
              key={g.group_id}
              className="group-card glass-panel"
              onClick={() => navigate(`/chat/group:${g.group_id}`)}
            >
              <div className="group-card-header">
                <div className="group-avatar">👥</div>
                <div className="group-info">
                  <div className="group-name">{g.name}</div>
                  <div className="group-id mono">ID: {g.group_id}</div>
                </div>
              </div>
              <div className="group-card-footer">
                <span className="tag">Sender-Key Protected</span>
                <span className="action-hint">Enter Chat →</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
