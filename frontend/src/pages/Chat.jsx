import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getIdentity, encryptMessage, decryptMessage } from '../crypto/keys';
import { decryptGroupMessage, encryptGroupMessage } from '../crypto/groupCrypto';
import { getContact } from '../store/contacts';
import { getMessages, addMessage } from '../store/messages';
import wsManager, { ConnectionState } from '../services/websocket';
import ConnectionStatus from '../components/ConnectionStatus';
import MessageBubble from '../components/MessageBubble';

export default function Chat() {
  const { id } = useParams(); // contact user_id or group:<group_id>
  const navigate = useNavigate();
  const identity = getIdentity();
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const isGroup = id.startsWith('group:');
  const conversationId = id;
  const contactUserId = isGroup ? null : id;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  const [contact, setContact] = useState(null);
  const [typing, setTyping] = useState(false);
  const [groupKey, setGroupKey] = useState(null);

  // Load contact info and messages
  useEffect(() => {
    if (!isGroup && contactUserId) {
      const c = getContact(contactUserId);
      setContact(c);
    }

    // Load group key from localStorage if group chat
    if (isGroup) {
      const groupId = id.replace('group:', '');
      const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
      setGroupKey(storedKeys[groupId] || null);
    }

    setMessages(getMessages(conversationId));
  }, [conversationId, contactUserId, isGroup, id]);

  // Subscribe to connection state
  useEffect(() => {
    return wsManager.onStateChange(setConnectionState);
  }, []);

  // Listen for incoming messages
  useEffect(() => {
    const handleMessage = (data) => {
      if (!identity) return;

      // 1:1 message from this contact
      if (data.type === 'message' && data.sender_id === contactUserId) {
        const senderContact = getContact(data.sender_id);
        if (!senderContact) return;

        const plaintext = decryptMessage(
          data.encrypted_payload,
          data.nonce,
          senderContact.public_key,
          identity.secretKey
        );

        if (plaintext) {
          const msgs = addMessage(conversationId, {
            id: data.id,
            senderId: data.sender_id,
            text: plaintext,
            timestamp: data.timestamp,
            status: 'delivered',
          });
          setMessages([...msgs]);
        }
      }
    };

    const handleGroupMessage = (data) => {
      if (!identity || !isGroup) return;
      const groupId = id.replace('group:', '');

      if (data.type === 'group_message' && data.group_id === groupId) {
        // Decrypt with group key
        const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
        const gk = storedKeys[groupId];
        if (!gk) return;

        const plaintext = decryptGroupMessage(data.encrypted_payload, data.nonce, gk);
        if (plaintext) {
          const senderContact = getContact(data.sender_id);
          const msgs = addMessage(conversationId, {
            id: data.id,
            senderId: data.sender_id,
            senderName: senderContact?.display_name || data.sender_id.substring(0, 8),
            text: plaintext,
            timestamp: data.timestamp,
            status: 'delivered',
            isGroup: true,
          });
          setMessages([...msgs]);
        }
      }
    };

    const handleTyping = (data) => {
      if (data.sender_id === contactUserId || (isGroup && data.group_id === id.replace('group:', ''))) {
        setTyping(true);
        setTimeout(() => setTyping(false), 3000);
      }
    };

    const unsub1 = wsManager.on('message', handleMessage);
    const unsub2 = wsManager.on('group_message', handleGroupMessage);
    const unsub3 = wsManager.on('typing', handleTyping);

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [identity, contactUserId, conversationId, isGroup, id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getSettings = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem('ciphermesh_settings') || '{}');
    } catch { return {}; }
  }, []);

  const handleSend = () => {
    if (!input.trim() || !identity) return;

    const text = input.trim();
    setInput('');
    inputRef.current?.focus();

    const settings = getSettings();
    const privacyMode = settings.privacyMode || 'direct';

    if (isGroup) {
      // Group message — encrypt with group symmetric key
      const groupId = id.replace('group:', '');
      const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
      const gk = storedKeys[groupId];
      if (!gk) {
        alert('No group key found. You may need to rejoin the group.');
        return;
      }

      const { encrypted, nonce } = encryptGroupMessage(text, gk);

      // Add to local store immediately (optimistic)
      const localId = `local-${Date.now()}`;
      const msgs = addMessage(conversationId, {
        id: localId,
        senderId: identity.userId,
        text,
        timestamp: Date.now() / 1000,
        status: 'sending',
        isGroup: true,
      });
      setMessages([...msgs]);

      // Send via WebSocket
      wsManager.send({
        type: 'group_message',
        group_id: groupId,
        encrypted_payload: encrypted,
        nonce,
        privacy_mode: privacyMode,
      });
    } else {
      // 1:1 message — encrypt with recipient's public key
      if (!contact) return;

      const { encrypted, nonce } = encryptMessage(text, contact.public_key, identity.secretKey);

      // Add to local store immediately (optimistic)
      const localId = `local-${Date.now()}`;
      const msgs = addMessage(conversationId, {
        id: localId,
        senderId: identity.userId,
        text,
        timestamp: Date.now() / 1000,
        status: 'sending',
      });
      setMessages([...msgs]);

      // Send via WebSocket
      wsManager.send({
        type: 'message',
        recipient_id: contactUserId,
        encrypted_payload: encrypted,
        nonce,
        privacy_mode: privacyMode,
      });
    }
  };

  // Listen for message acks to update status
  useEffect(() => {
    const handleAck = (data) => {
      if (data.type === 'message_ack') {
        // Update the latest sending message to sent/delivered
        setMessages(prev => prev.map(m =>
          m.status === 'sending'
            ? { ...m, status: data.status === 'delivered' ? 'delivered' : 'sent', id: data.id || m.id }
            : m
        ));
      }
    };

    return wsManager.on('message_ack', handleAck);
  }, []);

  const handleTypingInput = (e) => {
    setInput(e.target.value);
    // Send typing indicator (throttled)
    if (contactUserId) {
      wsManager.sendTyping(contactUserId);
    }
  };

  const chatTitle = isGroup
    ? id.replace('group:', 'Group: ')
    : (contact?.display_name || contactUserId?.substring(0, 12));

  return (
    <div className="page chat-page">
      <div className="chat-header glass-panel">
        <button className="btn-icon back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <div className="chat-header-info">
          <h2>{chatTitle}</h2>
          {!isGroup && contact && (
            <span className={`header-status ${contact.online ? 'online' : 'offline'}`}>
              {contact.online ? 'Online' : 'Offline'}
            </span>
          )}
          {typing && <span className="typing-indicator">typing...</span>}
        </div>
        <div className="chat-header-actions">
          <span className="encryption-badge" title="End-to-end encrypted">
            🔒 E2E
          </span>
        </div>
      </div>

      <ConnectionStatus state={connectionState} />

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div className="empty-icon">💬</div>
            <p>No messages yet</p>
            <p className="subtitle">Messages are end-to-end encrypted</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={msg.id || i}
              message={msg}
              isOwn={msg.senderId === identity?.userId}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar glass-panel">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleTypingInput}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          autoFocus
        />
        <button
          className="btn btn-send"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
