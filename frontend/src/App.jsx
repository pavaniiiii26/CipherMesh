import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { getIdentity, decryptMessage } from './crypto/keys';
import { decryptGroupMessage } from './crypto/groupCrypto';
import { getContact } from './store/contacts';
import { addMessage } from './store/messages';
import wsManager, { ConnectionState } from './services/websocket';
import { getPendingMessages, acknowledgeMessages } from './services/api';

import Navbar from './components/Navbar';
import IdentitySetup from './pages/IdentitySetup';
import Contacts from './pages/Contacts';
import Chat from './pages/Chat';
import Groups from './pages/Groups';
import QRPage from './pages/QRPage';
import Settings from './pages/Settings';

export default function App() {
  const [identity, setIdentity] = useState(() => getIdentity());
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  const location = useLocation();

  // Watch for identity changes
  useEffect(() => {
    const id = getIdentity();
    setIdentity(id);
  }, [location]);

  // Connect to WebSocket relay whenever identity is available
  useEffect(() => {
    if (!identity) return;

    wsManager.connect(identity.userId);
    const unsubState = wsManager.onStateChange(setConnectionState);

    // Global listener for incoming direct messages
    const unsubMsg = wsManager.on('message', (data) => {
      const senderContact = getContact(data.sender_id);
      if (!senderContact) {
        console.warn('Received message from unknown contact:', data.sender_id);
        return;
      }

      const plaintext = decryptMessage(
        data.encrypted_payload,
        data.nonce,
        senderContact.public_key,
        identity.secretKey
      );

      if (plaintext) {
        addMessage(data.sender_id, {
          id: data.id,
          senderId: data.sender_id,
          text: plaintext,
          timestamp: data.timestamp,
          status: 'delivered',
        });
      }
    });

    // Global listener for incoming group messages
    const unsubGroupMsg = wsManager.on('group_message', (data) => {
      const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
      const groupKey = storedKeys[data.group_id];
      if (!groupKey) return;

      const plaintext = decryptGroupMessage(data.encrypted_payload, data.nonce, groupKey);
      if (plaintext) {
        const senderContact = getContact(data.sender_id);
        addMessage(`group:${data.group_id}`, {
          id: data.id,
          senderId: data.sender_id,
          senderName: senderContact?.display_name || data.sender_id.substring(0, 8),
          text: plaintext,
          timestamp: data.timestamp,
          status: 'delivered',
          isGroup: true,
        });
      }
    });

    // Polling fallback: check for pending messages every 15 seconds if offline
    const pollInterval = setInterval(async () => {
      if (wsManager.state === ConnectionState.OFFLINE) {
        try {
          const res = await getPendingMessages(identity.userId);
          if (res.messages && res.messages.length > 0) {
            const deliveredIds = [];
            for (const msg of res.messages) {
              if (msg.group_id) {
                const storedKeys = JSON.parse(localStorage.getItem('ciphermesh_group_keys') || '{}');
                const groupKey = storedKeys[msg.group_id];
                if (groupKey) {
                  const plain = decryptGroupMessage(msg.encrypted_payload, msg.nonce, groupKey);
                  if (plain) {
                    addMessage(`group:${msg.group_id}`, {
                      id: msg.id,
                      senderId: msg.sender_id,
                      text: plain,
                      timestamp: msg.timestamp,
                      status: 'delivered',
                      isGroup: true,
                    });
                    deliveredIds.push(msg.id);
                  }
                }
              } else {
                const senderContact = getContact(msg.sender_id);
                if (senderContact) {
                  const plain = decryptMessage(
                    msg.encrypted_payload,
                    msg.nonce,
                    senderContact.public_key,
                    identity.secretKey
                  );
                  if (plain) {
                    addMessage(msg.sender_id, {
                      id: msg.id,
                      senderId: msg.sender_id,
                      text: plain,
                      timestamp: msg.timestamp,
                      status: 'delivered',
                    });
                    deliveredIds.push(msg.id);
                  }
                }
              }
            }
            if (deliveredIds.length > 0) {
              await acknowledgeMessages(identity.userId, deliveredIds);
            }
          }
        } catch (err) {
          console.error('Polling fallback error:', err);
        }
      }
    }, 15000);

    return () => {
      unsubState();
      unsubMsg();
      unsubGroupMsg();
      clearInterval(pollInterval);
    };
  }, [identity]);

  const hasIdentity = Boolean(identity);

  return (
    <div className="app-container">
      {hasIdentity && <Navbar connectionState={connectionState} />}
      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={hasIdentity ? <Navigate to="/contacts" replace /> : <IdentitySetup />}
          />
          <Route
            path="/contacts"
            element={hasIdentity ? <Contacts /> : <Navigate to="/" replace />}
          />
          <Route
            path="/chat/:id"
            element={hasIdentity ? <Chat /> : <Navigate to="/" replace />}
          />
          <Route
            path="/groups"
            element={hasIdentity ? <Groups /> : <Navigate to="/" replace />}
          />
          <Route
            path="/qr"
            element={hasIdentity ? <QRPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/settings"
            element={hasIdentity ? <Settings /> : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
