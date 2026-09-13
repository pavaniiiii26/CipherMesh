import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';
import QRCodeDisplay from '../components/QRCodeDisplay';
import { addContact } from '../store/contacts';
import { resolveContact } from '../services/api';
import wsManager from '../services/websocket';

export default function QRPage() {
  const [activeTab, setActiveTab] = useState('my-qr'); // 'my-qr' | 'scan'
  const [scannedText, setScannedText] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const navigate = useNavigate();
  const identity = getIdentity();

  const handleCopyPayload = () => {
    if (!identity) return;
    const payload = JSON.stringify({
      user_id: identity.userId,
      public_key: identity.publicKey,
      display_name: identity.displayName,
    }, null, 2);

    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleProcessPayload = async () => {
    setError(null);
    setMessage(null);

    if (!scannedText.trim()) {
      setError('Please paste a QR payload or user ID');
      return;
    }

    try {
      let contactData;
      try {
        contactData = JSON.parse(scannedText.trim());
      } catch {
        // Assume plain user_id and resolve via relay server
        contactData = await resolveContact(scannedText.trim());
      }

      if (!contactData.user_id || !contactData.public_key) {
        throw new Error('Payload is missing user_id or public_key');
      }

      if (contactData.user_id === identity?.userId) {
        throw new Error("Cannot add your own identity as a contact");
      }

      addContact(contactData);
      wsManager.subscribePresence([contactData.user_id]);
      setMessage(`Contact "${contactData.display_name || contactData.user_id}" added successfully!`);
      setScannedText('');
      setTimeout(() => navigate('/contacts'), 1200);
    } catch (err) {
      setError(err.message || 'Failed to process contact payload');
    }
  };

  return (
    <div className="page qr-page">
      <div className="tabs-header">
        <button
          className={`tab-btn ${activeTab === 'my-qr' ? 'active' : ''}`}
          onClick={() => setActiveTab('my-qr')}
        >
          My QR Code
        </button>
        <button
          className={`tab-btn ${activeTab === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan')}
        >
          Scan / Import
        </button>
      </div>

      {activeTab === 'my-qr' && identity && (
        <div className="qr-container glass-panel">
          <h2>Your Public Identity</h2>
          <p className="subtitle">
            Share this QR code with contacts to establish an end-to-end encrypted channel.
          </p>

          <div className="qr-box">
            <QRCodeDisplay
              userId={identity.userId}
              publicKey={identity.publicKey}
              displayName={identity.displayName}
              size={220}
            />
          </div>

          <div className="qr-actions">
            <button className="btn btn-secondary" onClick={handleCopyPayload}>
              {copied ? '✓ Payload Copied!' : '📋 Copy Raw Payload'}
            </button>
          </div>

          <div className="crypto-details">
            <div className="detail-item">
              <label>Fingerprint (User ID):</label>
              <code className="mono">{identity.userId}</code>
            </div>
            <div className="detail-item">
              <label>Public Key:</label>
              <code className="mono truncate">{identity.publicKey}</code>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'scan' && (
        <div className="scan-container glass-panel">
          <h2>Add Contact via QR / Fingerprint</h2>
          <p className="subtitle">
            Scan a contact&apos;s QR code or paste their exported payload / user ID.
          </p>

          <div className="input-group">
            <label>QR Payload JSON or User ID</label>
            <textarea
              rows={5}
              value={scannedText}
              onChange={e => setScannedText(e.target.value)}
              placeholder='Paste JSON payload like:&#10;{"user_id": "...", "public_key": "...", "display_name": "..."}'
            />
          </div>

          {error && <div className="error-message">{error}</div>}
          {message && <div className="success-message">{message}</div>}

          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleProcessPayload}>
              Import & Verify Contact
            </button>
          </div>

          <div className="scan-tip">
            <span>💡 Tip:</span> You can test multi-user messaging by opening an incognito window or another browser, generating a second identity, and copying the payload here!
          </div>
        </div>
      )}
    </div>
  );
}
