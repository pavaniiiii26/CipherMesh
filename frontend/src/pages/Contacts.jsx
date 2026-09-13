import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';
import { resolveContact, getUserGroups } from '../services/api';
import {
  getContacts,
  addContact as addContactLocal,
  removeContact as removeContactLocal,
} from '../store/contacts';
import { getMessages } from '../store/messages';
import ConversationListItem from '../components/ConversationListItem';
import FilterTabBar from '../components/FilterTabBar';
import SafetyNumberModal from '../components/SafetyNumberModal';
import Chat from './Chat';
import wsManager from '../services/websocket';
import { Search, UserPlus, QrCode, X, MessageSquare, ShieldCheck } from 'lucide-react';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState(null);
  const [addLoading, setAddLoading] = useState(false);
  const [safetyModalContact, setSafetyModalContact] = useState(null);
  const [selectedDesktopChatId, setSelectedDesktopChatId] = useState(null);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  const navigate = useNavigate();
  const identity = getIdentity();

  // Handle window resize for desktop vs mobile layout
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const userId = identity?.userId;

  const refreshData = useCallback(async () => {
    setContacts(getContacts());
    if (userId) {
      try {
        const res = await getUserGroups(userId);
        setGroups(res.groups || []);
      } catch (err) {
        console.error('Failed to load groups:', err);
      }
    }
  }, [userId]);

  useEffect(() => {
    refreshData();

    // Subscribe to presence updates
    const unsub1 = wsManager.on('presence', (data) => {
      setContacts(prev => prev.map(c =>
        c.user_id === data.user_id ? { ...c, online: data.status === 'online' } : c
      ));
    });

    const unsub2 = wsManager.on('presence_batch', (data) => {
      setContacts(prev => prev.map(c => ({
        ...c,
        online: data.states[c.user_id] === 'online',
      })));
    });

    const contactIds = getContacts().map(c => c.user_id);
    if (contactIds.length > 0) {
      wsManager.subscribePresence(contactIds);
    }

    return () => {
      unsub1();
      unsub2();
    };
  }, [refreshData]);

  const handleAddContact = async () => {
    setAddError(null);
    setAddLoading(true);

    try {
      let contactData;
      let source = 'manual_id';

      try {
        contactData = JSON.parse(addInput);
        source = 'qr_scan';
      } catch {
        contactData = await resolveContact(addInput.trim());
        source = 'manual_id';
      }

      if (!contactData.user_id || !contactData.public_key) {
        throw new Error('Invalid contact payload — missing user_id or public_key');
      }

      if (contactData.user_id === identity?.userId) {
        throw new Error("That is your own Identity ID!");
      }

      if (contactData.display_name) {
        contactData.display_name = contactData.display_name.trim().replace(/[<>]/g, '').slice(0, 32);
      }

      addContactLocal(contactData, source);
      refreshData();
      setShowAdd(false);
      setAddInput('');

      wsManager.subscribePresence([contactData.user_id]);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleContactClick = (item) => {
    const targetId = item.group_id ? `group:${item.group_id}` : item.user_id;
    if (isDesktop) {
      setSelectedDesktopChatId(targetId);
    } else {
      navigate(`/chat/${targetId}`);
    }
  };

  // Prepare combined list of contacts and groups
  const contactItems = contacts.map(c => {
    const msgs = getMessages(c.user_id);
    const lastMsg = msgs[msgs.length - 1];
    const unread = msgs.filter(m => m.status !== 'read' && m.senderId === c.user_id).length;
    return { ...c, type: 'contact', lastMessage: lastMsg, unreadCount: unread };
  });

  const groupItems = groups.map(g => {
    const cid = `group:${g.group_id}`;
    const msgs = getMessages(cid);
    const lastMsg = msgs[msgs.length - 1];
    const unread = msgs.filter(m => m.status !== 'read' && m.senderId !== identity?.userId).length;
    return { ...g, type: 'group', lastMessage: lastMsg, unreadCount: unread };
  });

  let allList = [];
  if (activeFilter === 'contacts') {
    allList = contactItems;
  } else if (activeFilter === 'groups') {
    allList = groupItems;
  } else {
    allList = [...contactItems, ...groupItems].sort((a, b) => {
      const timeA = a.lastMessage?.timestamp || (a.addedAt ? new Date(a.addedAt).getTime() / 1000 : 0);
      const timeB = b.lastMessage?.timestamp || (b.addedAt ? new Date(b.addedAt).getTime() / 1000 : 0);
      return timeB - timeA;
    });
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    allList = allList.filter(item => {
      const name = item.display_name || item.name || item.user_id;
      return name.toLowerCase().includes(q) || (item.user_id && item.user_id.toLowerCase().includes(q));
    });
  }

  const counts = {
    all: contactItems.length + groupItems.length,
    contacts: contactItems.length,
    groups: groupItems.length,
  };

  return (
    <div className="contacts-page-layout">
      {/* Left Pane (Chats & Contacts List) */}
      <div className="chats-sidebar-pane">
        <div className="chats-sidebar-header">
          <div className="chats-title-row">
            <h1 className="chats-main-title">Chats</h1>
            <button
              className="chats-header-btn"
              onClick={() => setShowAdd(!showAdd)}
              title="Add Contact"
            >
              {showAdd ? <X size={20} /> : <UserPlus size={20} />}
            </button>
          </div>

          <div className="search-bar-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button className="clear-search-btn" onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <FilterTabBar
            activeTab={activeFilter}
            onTabChange={setActiveFilter}
            counts={counts}
          />
        </div>

        {showAdd && (
          <div className="add-contact-card">
            <h3>Add Contact</h3>
            <p className="card-sub">Paste User ID or Identity QR Payload JSON</p>
            <textarea
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              placeholder='{"user_id": "...", "public_key": "..."} or User ID'
              rows={3}
              className="add-input-area"
            />
            {addError && <div className="add-error-badge">{addError}</div>}
            <div className="add-card-actions">
              <button
                className="btn btn-indigo"
                onClick={handleAddContact}
                disabled={!addInput.trim() || addLoading}
              >
                {addLoading ? 'Resolving...' : 'Add Contact'}
              </button>
              <button className="btn btn-outline" onClick={() => navigate('/qr')}>
                <QrCode size={16} />
                <span>Scan QR</span>
              </button>
            </div>
          </div>
        )}

        <div className="conversation-scroll-list">
          {allList.length === 0 ? (
            <div className="empty-chats-state">
              <MessageSquare size={36} color="#9CA3AF" />
              <h4>No conversations found</h4>
              <p>Add contacts by User ID or QR code to start messaging</p>
              <button className="btn btn-indigo" onClick={() => setShowAdd(true)}>
                <UserPlus size={16} />
                <span>Add Contact</span>
              </button>
            </div>
          ) : (
            allList.map((item) => {
              const targetId = item.group_id ? `group:${item.group_id}` : item.user_id;
              const isActive = selectedDesktopChatId === targetId;

              return (
                <div key={targetId} className="conversation-item-container">
                  <ConversationListItem
                    contact={item}
                    lastMessage={item.lastMessage}
                    unreadCount={item.unreadCount}
                    isActive={isActive}
                    onClick={() => handleContactClick(item)}
                    onVerifyClick={(c) => setSafetyModalContact(c)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Pane (Desktop Active Chat View) */}
      {isDesktop && (
        <div className="chats-detail-pane">
          {selectedDesktopChatId ? (
            <Chat conversationId={selectedDesktopChatId} onBack={() => setSelectedDesktopChatId(null)} />
          ) : (
            <div className="no-chat-selected-state">
              <div className="no-chat-icon-circle">
                <ShieldCheck size={48} color="#5B6EF5" />
              </div>
              <h2>CipherMesh Encrypted Messenger</h2>
              <p>Select a chat from the left pane to view end-to-end encrypted messages.</p>
            </div>
          )}
        </div>
      )}

      {safetyModalContact && (
        <SafetyNumberModal
          contact={safetyModalContact}
          onClose={() => setSafetyModalContact(null)}
          onVerificationChange={() => refreshData()}
        />
      )}
    </div>
  );
}
