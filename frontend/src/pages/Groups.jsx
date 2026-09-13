import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';
import { generateGroupKey, encryptGroupKey } from '../crypto/groupCrypto';
import { createGroup as createGroupApi, getUserGroups, addGroupMember as addGroupMemberApi } from '../services/api';
import { getContacts } from '../store/contacts';
import IdentityAvatar from '../components/IdentityAvatar';
import { Users, Plus, Check, Lock, ShieldCheck, X } from 'lucide-react';

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
      const newGroupKey = generateGroupKey();
      const group = await createGroupApi(groupName.trim(), identity.userId);
      const groupId = group.group_id;

      const storedKeys = JSON.parse(localStorage.getItem(GROUP_KEYS_STORAGE) || '{}');
      storedKeys[groupId] = newGroupKey;
      localStorage.setItem(GROUP_KEYS_STORAGE, JSON.stringify(storedKeys));

      const selfEnc = encryptGroupKey(newGroupKey, identity.publicKey, identity.secretKey);
      await addGroupMemberApi(groupId, identity.userId, selfEnc.encrypted, selfEnc.nonce);

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
    <div className="page groups-page-container">
      <div className="page-header-row">
        <div>
          <h1 className="page-main-title">Encrypted Groups</h1>
          <p className="page-subtitle">Sender-keys encrypted group messaging with Ed25519 signatures</p>
        </div>
        <button className="btn btn-indigo" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <X size={18} /> : <Plus size={18} />}
          <span>{showCreate ? 'Cancel' : 'New Group'}</span>
        </button>
      </div>

      {showCreate && (
        <div className="group-creation-card">
          <h3>Create Encrypted Group</h3>
          <p className="card-sub">Generate symmetric key & distribute to selected contacts</p>

          <div className="field-group">
            <label className="field-label">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="e.g. Core Security Team"
              className="text-input"
            />
          </div>

          <div className="field-group">
            <label className="field-label">Select Group Members</label>
            {contacts.length === 0 ? (
              <p className="hint-text">Add contacts first to include them in group chats.</p>
            ) : (
              <div className="contact-selection-list">
                {contacts.map(c => {
                  const isSelected = selectedContacts.includes(c.user_id);
                  return (
                    <div
                      key={c.user_id}
                      className={`select-contact-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleContactSelection(c.user_id)}
                    >
                      <IdentityAvatar name={c.display_name} userId={c.user_id} size={36} />
                      <span className="contact-item-name">{c.display_name}</span>
                      <div className="check-box-square">
                        {isSelected && <Check size={14} color="#FFFFFF" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && <div className="badge-error-banner">{error}</div>}

          <div className="action-row">
            <button
              className="btn btn-indigo"
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || loading}
            >
              {loading ? 'Generating Key...' : 'Create Group'}
            </button>
          </div>
        </div>
      )}

      <div className="groups-grid-list">
        {groups.length === 0 ? (
          <div className="empty-groups-card">
            <Users size={40} color="#9CA3AF" />
            <h3>No encrypted groups yet</h3>
            <p>Create a group to exchange messages signed with Ed25519 digital signatures.</p>
            <button className="btn btn-indigo" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              <span>Create Group</span>
            </button>
          </div>
        ) : (
          groups.map(group => (
            <div
              key={group.group_id}
              className="group-card-item"
              onClick={() => navigate(`/chat/group:${group.group_id}`)}
            >
              <IdentityAvatar name={group.name} isGroup={true} size={48} />
              <div className="group-card-info">
                <div className="group-card-header">
                  <span className="group-card-name">{group.name}</span>
                  <span className="badge-e2ee">
                    <Lock size={12} />
                    <span>E2EE</span>
                  </span>
                </div>
                <div className="group-card-meta">
                  <span className="mono">ID: {group.group_id.substring(0, 10)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
