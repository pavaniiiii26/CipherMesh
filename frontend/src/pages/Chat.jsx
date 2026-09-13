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
import { encryptFile, decryptFile, isFilePayload } from '../crypto/fileSharing';
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
import SafetyNumberModal from '../components/SafetyNumberModal';

const TTL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30 },
  { label: '5m', value: 300 },
  { label: '1h', value: 3600 },
  { label: '24h', value: 86400 },
];

export default function Chat() {
  const { id } = useParams(); // contact user_id or group:<group_id>
  const navigate = useNavigate();
  const identity = getIdentity();
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const lastTypingRef = useRef(0);

  const isGroup = id.startsWith('group:');
  const conversationId = id;
  const contactUserId = isGroup ? null : id;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  const [contact, setContact] = useState(null);
  const [typing, setTyping] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(null);
  const fileInputRef = useRef(null);

  // Settings: privacy toggles and default TTL
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

  // Load contact info and initial messages
  useEffect(() => {
    if (!isGroup && contactUserId) {
      const c = getContact(contactUserId);
      setContact(c);
    }

    setMessages(getMessages(conversationId));
  }, [conversationId, contactUserId, isGroup, id]);

  // Periodic sweeper for disappearing messages
  useEffect(() => {
    const interval = setInterval(() => {
      purgeExpiredMessages();
      setMessages(getMessages(conversationId));
    }, 2000);
    return () => clearInterval(interval);
  }, [conversationId]);

  // Mark messages as read and send read receipt if enabled
  useEffect(() => {
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

  // Subscribe to connection state
  useEffect(() => {
    return wsManager.onStateChange(setConnectionState);
  }, []);

  // Listen for incoming messages, read receipts, and typing
  useEffect(() => {
    const handleMessage = (data) => {
      if (!identity) return;

      // 1:1 message from this contact
      if (data.type === 'message' && data.sender_id === contactUserId) {
        const senderContact = getContact(data.sender_id);
        if (!senderContact) return;

        // Decrypt with Double Ratchet (preferred) or forward secrecy ephemeral key
        const keyToUse = data.dr_ephemeral || data.ephemeral_key || senderContact.public_key;
        const plaintext = decryptMessageWithForwardSecrecy(
          data.encrypted_payload,
          data.nonce,
          keyToUse,
          identity.secretKey,
          conversationId // Pass for Double Ratchet state lookup
        );

        if (plaintext) {
          // Check if this is an encrypted file payload
          let messageData = { text: plaintext };
          if (isFilePayload(plaintext)) {
            try {
              const fileData = decryptFile(plaintext, identity.secretKey);
              messageData = { text: null, file: fileData };
            } catch (err) {
              console.warn('[File] Failed to decrypt file:', err);
            }
          }

          const msgs = addMessage(conversationId, {
            id: data.id,
            senderId: data.sender_id,
            text: messageData.text,
            file: messageData.file || null,
            timestamp: data.timestamp,
            status: 'delivered',
            nonce: data.nonce,
            ttl: data.ttl,
            expiresAt: data.expires_at,
          });
          setMessages([...msgs]);

          // Send read receipt if enabled
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
      const groupId = id.replace('group:', '');

      if (data.type === 'group_message' && data.group_id === groupId) {
        const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
        const gk = storedKeys[groupId];
        if (!gk) return;

        // Verify digital signature from sender's signing key
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
          // Check if this is an encrypted file payload
          let messageData = { text: plaintext };
          if (isFilePayload(plaintext)) {
            try {
              const fileData = decryptFile(plaintext, gk);
              messageData = { text: null, file: fileData };
            } catch (err) {
              console.warn('[File] Failed to decrypt group file:', err);
            }
          }

          const msgs = addMessage(conversationId, {
            id: data.id,
            senderId: data.sender_id,
            senderName: senderContact?.display_name || data.sender_id.substring(0, 8),
            text: messageData.text,
            file: messageData.file || null,
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
      if (data.sender_id === contactUserId || (isGroup && data.group_id === id.replace('group:', ''))) {
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
  }, [identity, contactUserId, conversationId, isGroup, id, getSettings]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !identity) return;

    const text = input.trim();
    setInput('');
    inputRef.current?.focus();

    const settings = getSettings();
    const privacyMode = settings.privacyMode || 'direct';
    const now = Date.now() / 1000;
    const expiresAt = ttl > 0 ? (now + ttl) : null;

    if (isGroup) {
      // Group message with sender Ed25519 signature
      const groupId = id.replace('group:', '');
      const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
      const gk = storedKeys[groupId];
      if (!gk) {
        alert('No group key found. You may need to rejoin the group.');
        return;
      }

      const { encrypted, nonce, signature } = encryptGroupMessage(
        text,
        gk,
        identity.signingSecretKey,
        { groupId, senderId: identity.userId }
      );

      const localId = `local-${Date.now()}`;
      const msgs = addMessage(conversationId, {
        id: localId,
        senderId: identity.userId,
        text,
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
      // 1:1 message with Double Ratchet + Forward Secrecy
      if (!contact) return;

      const { encrypted, nonce, ephemeralPublicKey, dr_ephemeral, dr_message_number, dr_flag } = encryptMessageWithForwardSecrecy(
        text,
        contact.public_key,
        conversationId // Pass conversationId for Double Ratchet
      );

      const localId = `local-${Date.now()}`;
      const msgs = addMessage(conversationId, {
        id: localId,
        senderId: identity.userId,
        text,
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
        ephemeral_key: dr_flag ? null : ephemeralPublicKey,
        dr_ephemeral: dr_flag ? dr_ephemeral : null,
        dr_message_number: dr_flag ? dr_message_number : null,
        ttl: ttl > 0 ? ttl : null,
        privacy_mode: privacyMode,
      });
    }
  };

  // File upload handler
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !identity) return;

    const settings = getSettings();
    const privacyMode = settings.privacyMode || 'direct';
    const now = Date.now() / 1000;
    const expiresAt = ttl > 0 ? (now + ttl) : null;

    try {
      setUploadingFile(file.name);

      if (isGroup) {
        const groupId = id.replace('group:', '');
        const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
        const gk = storedKeys[groupId];
        if (!gk) {
          alert('No group key found.');
          return;
        }

        const { encryptedPayload } = await encryptFile(file, gk, {
          groupId,
          senderId: identity.userId,
        });

        const localId = `local-${Date.now()}`;
        const msgs = addMessage(conversationId, {
          id: localId,
          senderId: identity.userId,
          text: encryptedPayload,
          file: {
            name: file.name,
            type: file.type,
            size: file.size,
          },
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
          encrypted_payload: encryptedPayload,
          nonce: 'file-blob',
          signature: null,
          ttl: ttl > 0 ? ttl : null,
          privacy_mode: privacyMode,
        });
      } else if (contact) {
        const { encryptedPayload } = await encryptFile(file, contact.public_key, {
          conversationId,
        });

        const localId = `local-${Date.now()}`;
        const msgs = addMessage(conversationId, {
          id: localId,
          senderId: identity.userId,
          text: encryptedPayload,
          file: {
            name: file.name,
            type: file.type,
            size: file.size,
          },
          timestamp: now,
          status: 'sending',
          ttl: ttl > 0 ? ttl : null,
          expiresAt,
        });
        setMessages([...msgs]);

        wsManager.send({
          type: 'message',
          recipient_id: contactUserId,
          encrypted_payload: encryptedPayload,
          nonce: 'file-blob',
          ephemeral_key: null,
          ttl: ttl > 0 ? ttl : null,
          privacy_mode: privacyMode,
        });
      }
    } catch (err) {
      console.error('[File] Upload failed:', err);
      alert('File encryption failed: ' + err.message);
    } finally {
      setUploadingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Listen for message acks to update status
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

  const handleTypingInput = (e) => {
    setInput(e.target.value);
    const settings = getSettings();
    if (settings.sendTyping === false) return;

    const now = Date.now();
    if (now - lastTypingRef.current > 2000) {
      lastTypingRef.current = now;
      if (contactUserId) {
        wsManager.sendTyping(contactUserId);
      } else if (isGroup) {
        wsManager.sendTyping(null, id.replace('group:', ''));
      }
    }
  };

  const handleDeleteMessage = (msgId) => {
    const remaining = deleteMessage(conversationId, msgId);
    setMessages([...remaining]);
  };

  const chatTitle = isGroup
    ? id.replace('group:', 'Group: ')
    : (contact?.display_name || contactUserId?.substring(0, 12));

  return (
    <div className="page chat-page">
      <div className="chat-header glass-panel">
        <button className="btn-icon back-btn" onClick={() => navigate(-1)} title="Back">
          ←
        </button>

        <div className="chat-header-info">
          <div className="chat-title-row">
            <h2>{chatTitle}</h2>
            {!isGroup && contact?.verified && (
              <span className="verified-shield-badge" title="Safety numbers verified">
                🛡️ Verified
              </span>
            )}
            {!isGroup && contact?.keyChanged && (
              <span className="key-warning-badge" title="Public key was changed!">
                ⚠️ Key Replaced
              </span>
            )}
          </div>

          <div className="chat-sub-status">
            {!isGroup && contact && (
              <span className={`header-status ${contact.online ? 'online' : 'offline'}`}>
                {contact.online ? 'Online' : 'Offline'}
              </span>
            )}
            {typing && <span className="typing-indicator">typing...</span>}
          </div>
        </div>

        <div className="chat-header-actions">
          {/* Disappearing Messages (TTL) dropdown */}
          <div className="ttl-control" title="Disappearing messages timer">
            <span className="ttl-icon">⏱️</span>
            <select
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              className="ttl-select"
            >
              {TTL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {!isGroup && contact && (
            <button
              className={`btn btn-sm ${contact.verified ? 'btn-ghost' : 'btn-accent'}`}
              onClick={() => setShowSafetyModal(true)}
              title="Compare safety numbers for MITM protection"
            >
              {contact.verified ? '🛡️ Verified' : '🛡️ Verify Key'}
            </button>
          )}

          <span className="encryption-badge" title="Forward secrecy enabled E2EE">
            🔒 Forward Secrecy
          </span>
        </div>
      </div>

      <ConnectionStatus state={connectionState} />

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-chat glass-panel">
            <div className="empty-icon">🛡️</div>
            <h3>Zero-Knowledge End-to-End Encrypted</h3>
            <p>
              Messages sent in this chat are encrypted client-side with ephemeral forward secrecy.
              The relay server only ever routes opaque ciphertext.
            </p>
            {ttl > 0 && (
              <div className="ttl-notice-badge">
                ⏱️ Disappearing messages active: {TTL_OPTIONS.find(o => o.value === ttl)?.label}
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

      <div className="chat-input-bar glass-panel">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip"
          style={{ display: 'none' }}
        />
        <button
          className="btn btn-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={!!uploadingFile}
          title="Send encrypted file"
        >
          📎
        </button>
        {uploadingFile && (
          <span className="uploading-indicator">
            🔒 Encrypting {uploadingFile}...
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleTypingInput}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={ttl > 0 ? `Message (disappears in ${TTL_OPTIONS.find(o => o.value === ttl)?.label})...` : "Type an encrypted message..."}
          autoFocus
        />
        <button
          className="btn btn-send"
          onClick={handleSend}
          disabled={!input.trim()}
          title="Send encrypted message"
        >
          ➤
        </button>
      </div>

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
