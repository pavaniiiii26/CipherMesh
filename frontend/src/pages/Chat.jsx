import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getIdentity,
  encryptMessageWithForwardSecrecy,
  decryptMessageWithForwardSecrecy
} from '../crypto/keys';
import {
  decryptGroupMessage,
  encryptGroupMessage,
  verifyGroupMessageSignature
} from '../crypto/groupCrypto';
import { getContact } from '../store/contacts';
import {
  getMessages,
  addMessage,
  markMessagesAsRead,
  deleteMessage,
  purgeExpiredMessages
} from '../store/messages';
import wsManager, { ConnectionState } from '../services/websocket';
import ConnectionStatus from '../components/ConnectionStatus';
import MessageBubble from '../components/MessageBubble';
import ChatHeader from '../components/ChatHeader';
import ChatInputBar from '../components/ChatInputBar';
import SafetyNumberModal from '../components/SafetyNumberModal';
import { ShieldCheck, Timer, Lock } from 'lucide-react';

export default function Chat({ conversationId: propConversationId, onBack: propOnBack }) {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const identity = getIdentity();

  const conversationId = propConversationId || routeId;
  const isGroup = conversationId ? conversationId.startsWith('group:') : false;
  const contactUserId = isGroup ? null : conversationId;

  const messagesEndRef = useRef(null);
  const lastTypingRef = useRef(0);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  const [contact, setContact] = useState(null);
  const [typing, setTyping] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  const getSettings = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem('ciphermesh_settings') || '{}');
    } catch { return {}; }
  }, []);

  const [ttl, setTtl] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('ciphermesh_settings') || '{}');
      return s.defaultTtl || 0;
    } catch { return 0; }
  });

  useEffect(() => {
    if (!conversationId) return;

    if (!isGroup && contactUserId) {
      const c = getContact(contactUserId);
      setContact(c);
    }

    setMessages(getMessages(conversationId));
  }, [conversationId, contactUserId, isGroup]);

  useEffect(() => {
    if (!conversationId) return;
    const interval = setInterval(() => {
      purgeExpiredMessages();
      setMessages(getMessages(conversationId));
    }, 2000);
    return () => clearInterval(interval);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const settings = getSettings();
    if (messages.length > 0 && !isGroup && contactUserId) {
      markMessagesAsRead(conversationId);
      if (settings.sendReadReceipts !== false) {
        const unreadIds = messages.filter(m => m.senderId === contactUserId).map(m => m.id);
        if (unreadIds.length > 0) {
          wsManager.send({
            type: 'read_receipt',
            sender_id: contactUserId,
            conversation_id: conversationId,
            message_ids: unreadIds,
          });
        }
      }
    }
  }, [conversationId, contactUserId, isGroup, messages.length, getSettings]);

  useEffect(() => {
    return wsManager.onStateChange(setConnectionState);
  }, []);

  useEffect(() => {
    if (!conversationId) return;

    const handleMessage = (data) => {
      if (!identity) return;

      if (data.type === 'message' && data.sender_id === contactUserId) {
        const senderContact = getContact(data.sender_id);
        if (!senderContact) return;

        const keyToUse = data.ephemeral_key || senderContact.public_key;
        const plaintext = decryptMessageWithForwardSecrecy(
          data.encrypted_payload,
          data.nonce,
          keyToUse,
          identity.secretKey
        );

        if (plaintext) {
          const msgs = addMessage(conversationId, {
            id: data.id,
            senderId: data.sender_id,
            text: plaintext,
            timestamp: data.timestamp,
            status: 'delivered',
            nonce: data.nonce,
            ttl: data.ttl,
            expiresAt: data.expires_at,
          });
          setMessages([...msgs]);

          const settings = getSettings();
          if (settings.sendReadReceipts !== false) {
            wsManager.send({
              type: 'read_receipt',
              sender_id: data.sender_id,
              conversation_id: conversationId,
              message_ids: [data.id],
            });
          }
        }
      }
    };

    const handleGroupMessage = (data) => {
      if (!identity || !isGroup) return;
      const groupId = conversationId.replace('group:', '');

      if (data.type === 'group_message' && data.group_id === groupId) {
        const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
        const gk = storedKeys[groupId];
        if (!gk) return;

        const senderContact = getContact(data.sender_id);
        let signatureVerified = null;
        if (data.signature && senderContact?.signing_public_key) {
          signatureVerified = verifyGroupMessageSignature(
            data.signature,
            senderContact.signing_public_key,
            {
              groupId,
              senderId: data.sender_id,
              encrypted: data.encrypted_payload,
              nonce: data.nonce,
            }
          );
        }

        const plaintext = decryptGroupMessage(data.encrypted_payload, data.nonce, gk);
        if (plaintext) {
          const msgs = addMessage(conversationId, {
            id: data.id,
            senderId: data.sender_id,
            senderName: senderContact?.display_name || data.sender_id.substring(0, 8),
            text: plaintext,
            timestamp: data.timestamp,
            status: 'delivered',
            isGroup: true,
            nonce: data.nonce,
            ttl: data.ttl,
            expiresAt: data.expires_at,
            signatureVerified,
          });
          setMessages([...msgs]);
        }
      }
    };

    const handleReadReceipt = (data) => {
      if (data.conversation_id === conversationId || data.reader_id === contactUserId) {
        setMessages(prev => prev.map(m =>
          m.senderId === identity?.userId ? { ...m, status: 'read' } : m
        ));
      }
    };

    const handleTyping = (data) => {
      if (data.sender_id === contactUserId || (isGroup && data.group_id === conversationId.replace('group:', ''))) {
        setTyping(true);
        setTimeout(() => setTyping(false), 3000);
      }
    };

    const unsub1 = wsManager.on('message', handleMessage);
    const unsub2 = wsManager.on('group_message', handleGroupMessage);
    const unsub3 = wsManager.on('read_receipt', handleReadReceipt);
    const unsub4 = wsManager.on('typing', handleTyping);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [identity, contactUserId, conversationId, isGroup, getSettings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (customText = null) => {
    const textToSend = (customText || input).trim();
    if (!textToSend || !identity || !conversationId) return;

    if (!customText) setInput('');

    const settings = getSettings();
    const privacyMode = settings.privacyMode || 'direct';
    const now = Date.now() / 1000;
    const expiresAt = ttl > 0 ? (now + ttl) : null;

    if (isGroup) {
      const groupId = conversationId.replace('group:', '');
      const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
      const gk = storedKeys[groupId];
      if (!gk) {
        alert('No group key found for this group.');
        return;
      }

      const { encrypted, nonce, signature } = encryptGroupMessage(
        textToSend,
        gk,
        identity.signingSecretKey,
        { groupId, senderId: identity.userId }
      );

      const localId = `local-${Date.now()}`;
      const msgs = addMessage(conversationId, {
        id: localId,
        senderId: identity.userId,
        text: textToSend,
        timestamp: now,
        status: 'sending',
        isGroup: true,
        ttl: ttl > 0 ? ttl : null,
        expiresAt,
        signatureVerified: true,
      });
      setMessages([...msgs]);

      wsManager.send({
        type: 'group_message',
        group_id: groupId,
        encrypted_payload: encrypted,
        nonce,
        signature,
        ttl: ttl > 0 ? ttl : null,
        privacy_mode: privacyMode,
      });
    } else {
      if (!contact) return;

      const { encrypted, nonce, ephemeralPublicKey } = encryptMessageWithForwardSecrecy(
        textToSend,
        contact.public_key
      );

      const localId = `local-${Date.now()}`;
      const msgs = addMessage(conversationId, {
        id: localId,
        senderId: identity.userId,
        text: textToSend,
        timestamp: now,
        status: 'sending',
        ttl: ttl > 0 ? ttl : null,
        expiresAt,
      });
      setMessages([...msgs]);

      wsManager.send({
        type: 'message',
        recipient_id: contactUserId,
        encrypted_payload: encrypted,
        nonce,
        ephemeral_key: ephemeralPublicKey,
        ttl: ttl > 0 ? ttl : null,
        privacy_mode: privacyMode,
      });
    }
  };

  useEffect(() => {
    const handleAck = (data) => {
      if (data.type === 'message_ack') {
        setMessages(prev => prev.map(m =>
          m.status === 'sending'
            ? { ...m, status: data.status === 'delivered' ? 'delivered' : 'sent', id: data.id || m.id }
            : m
        ));
      }
    };
    return wsManager.on('message_ack', handleAck);
  }, []);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    const settings = getSettings();
    if (settings.sendTyping === false) return;

    const now = Date.now();
    if (now - lastTypingRef.current > 2000) {
      lastTypingRef.current = now;
      if (contactUserId) {
        wsManager.sendTyping(contactUserId);
      } else if (isGroup) {
        wsManager.sendTyping(null, conversationId.replace('group:', ''));
      }
    }
  };

  const handleDeleteMessage = (msgId) => {
    const remaining = deleteMessage(conversationId, msgId);
    setMessages([...remaining]);
  };

  const chatTitle = isGroup
    ? conversationId.replace('group:', 'Group: ')
    : (contact?.display_name || contactUserId?.substring(0, 12));

  const handleBackNavigation = propOnBack || (() => navigate(-1));

  return (
    <div className="chat-thread-container">
      <ChatHeader
        title={chatTitle}
        contact={contact}
        isGroup={isGroup}
        online={contact?.online}
        typing={typing}
        ttl={ttl}
        onTtlChange={setTtl}
        onBack={handleBackNavigation}
        onVerifyClick={(c) => setShowSafetyModal(true)}
      />

      <ConnectionStatus state={connectionState} />

      <div className="chat-messages-viewport">
        {messages.length === 0 ? (
          <div className="empty-thread-notice">
            <div className="notice-icon-box">
              <ShieldCheck size={36} color="#5B6EF5" />
            </div>
            <h3>End-to-End Encrypted Thread</h3>
            <p>
              Messages are encrypted client-side with ephemeral forward secrecy. The relay server cannot read or store plaintext content.
            </p>
            {ttl > 0 && (
              <div className="ttl-active-pill">
                <Timer size={14} />
                <span>Disappearing messages timer: {ttl}s</span>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={msg.id || i}
              message={msg}
              isOwn={msg.senderId === identity?.userId}
              onDelete={handleDeleteMessage}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInputBar
        value={input}
        onChange={handleInputChange}
        onSend={handleSend}
        placeholder={ttl > 0 ? `Message (disappears in ${ttl}s)...` : "Type an encrypted message..."}
      />

      {showSafetyModal && contact && (
        <SafetyNumberModal
          contact={contact}
          onClose={() => setShowSafetyModal(false)}
          onVerificationChange={(newStatus) => {
            setContact(prev => ({ ...prev, verified: newStatus }));
          }}
        />
      )}
    </div>
  );
}
