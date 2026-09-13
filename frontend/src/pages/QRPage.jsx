import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity } from '../crypto/keys';
import QRCodeCard from '../components/QRCodeCard';
import { addContact } from '../store/contacts';
import { resolveContact } from '../services/api';
import wsManager from '../services/websocket';
import { QrCode, Scan, Copy, Check, Info, ArrowRight } from 'lucide-react';

export default function QRPage() {
  const [activeTab, setActiveTab] = useState('my-qr'); // 'my-qr' | 'scan'
  const [scannedText, setScannedText] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const navigate = useNavigate();
  const identity = getIdentity();

  const handleProcessPayload = async () => {
    setError(null);
    setMessage(null);

    if (!scannedText.trim()) {
      setError('Please paste a QR payload or user ID');
      return;
    }

    try {
      let contactData;
      let source = 'manual_id';
      try {
        contactData = JSON.parse(scannedText.trim());
        source = 'qr_scan';
      } catch {
        contactData = await resolveContact(scannedText.trim());
        source = 'manual_id';
      }

      if (!contactData.user_id || !contactData.public_key) {
        throw new Error('Payload is missing user_id or public_key');
      }

      if (contactData.user_id === identity?.userId) {
        throw new Error("Cannot add your own identity as a contact");
      }

      addContact(contactData, source);
      wsManager.subscribePresence([contactData.user_id]);
      setMessage(`Contact "${contactData.display_name || contactData.user_id}" added successfully!`);
      setScannedText('');
      setTimeout(() => navigate('/contacts'), 1200);
    } catch (err) {
      setError(err.message || 'Failed to process contact payload');
    }
  };

  return (
    <div className="page qr-page-container">
      <div className="segmented-tab-control">
        <button
          className={`segment-btn ${activeTab === 'my-qr' ? 'active' : ''}`}
          onClick={() => setActiveTab('my-qr')}
        >
          <QrCode size={18} />
          <span>My QR Code</span>
        </button>
        <button
          className={`segment-btn ${activeTab === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan')}
        >
          <Scan size={18} />
          <span>Scan / Import</span>
        </button>
      </div>

      {activeTab === 'my-qr' && identity && (
        <div className="qr-card-center-layout">
          <QRCodeCard
            identity={identity}
            onScanClick={() => setActiveTab('scan')}
          />
        </div>
      )}

      {activeTab === 'scan' && (
        <div className="scan-card-wrapper">
          <div className="scan-card-header">
            <h2>Add Contact via QR / Fingerprint</h2>
            <p className="card-sub">
              Scan a contact&apos;s QR code or paste their exported payload / User ID.
            </p>
          </div>

          <div className="input-group-field">
            <label className="field-label">QR Payload JSON or User ID</label>
            <textarea
              rows={5}
              value={scannedText}
              onChange={e => setScannedText(e.target.value)}
              placeholder='Paste JSON payload like:&#10;{"user_id": "...", "public_key": "...", "display_name": "..."}'
              className="scan-textarea"
            />
          </div>

          {error && <div className="badge-error-banner">{error}</div>}
          {message && <div className="badge-success-banner">{message}</div>}

          <div className="scan-actions-row">
            <button className="btn btn-indigo" onClick={handleProcessPayload}>
              <span>Import & Verify Contact</span>
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="scan-tip-card">
            <Info size={18} color="#5B6EF5" />
            <span>Tip: Open an incognito tab to create a second identity, copy its payload, and test multi-user E2E encrypted chat!</span>
          </div>
        </div>
      )}
    </div>
  );
}
