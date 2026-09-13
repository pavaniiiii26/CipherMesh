import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity, deleteIdentity } from '../crypto/keys';
import PrivacyModeSelector from '../components/PrivacyModeSelector';

const SETTINGS_STORAGE_KEY = 'ciphermesh_settings';

export default function Settings() {
  const [privacyMode, setPrivacyMode] = useState('direct');
  const [identity, setIdentity] = useState(null);
  const [saveNote, setSaveNote] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const id = getIdentity();
    setIdentity(id);

    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
      if (stored.privacyMode) {
        setPrivacyMode(stored.privacyMode);
      }
    } catch {
      // default to direct
    }
  }, []);

  const handlePrivacyChange = (newMode) => {
    setPrivacyMode(newMode);
    const existing = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...existing, privacyMode: newMode }));
    setSaveNote(true);
    setTimeout(() => setSaveNote(false), 2000);
  };

  const handleDeleteIdentity = () => {
    if (confirm('CRITICAL ACTION: This will permanently delete your private keys, contacts, and all message histories stored on this device. Are you completely sure?')) {
      deleteIdentity();
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      localStorage.removeItem('ciphermesh_group_keys');
      navigate('/');
      window.location.reload();
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-header">
        <h1>Settings & Privacy</h1>
        <p className="subtitle">Configure encryption parameters and simulated network routing</p>
      </div>

      <div className="settings-section glass-panel">
        <PrivacyModeSelector value={privacyMode} onChange={handlePrivacyChange} />
        {saveNote && <div className="success-badge">✓ Setting saved</div>}
      </div>

      {identity && (
        <div className="settings-section glass-panel">
          <h3>Cryptographic Identity</h3>
          <div className="identity-info-list">
            <div className="info-row">
              <span className="info-label">Display Name</span>
              <span className="info-val">{identity.displayName}</span>
            </div>
            <div className="info-row">
              <span className="info-label">User ID (Fingerprint)</span>
              <span className="info-val mono">{identity.userId}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Public Key</span>
              <span className="info-val mono break-all">{identity.publicKey}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Private Key Storage</span>
              <span className="info-val safe">Local Browser Sandbox (never transmitted)</span>
            </div>
          </div>
          <div className="crypto-audit-note">
            <span>🛡️ Architecture Note:</span> In production, private keys would be isolated in a secure enclave / hardware security module (HSM) or WebCrypto non-extractable keys rather than plaintext browser storage.
          </div>
        </div>
      )}

      <div className="settings-section glass-panel danger-zone">
        <h3>Danger Zone</h3>
        <p className="subtitle">
          Purge local identity and wipe cryptographic keys. There is no backup or recovery mechanism.
        </p>
        <button className="btn btn-danger" onClick={handleDeleteIdentity}>
          Wipe Local Identity & Keys
        </button>
      </div>
    </div>
  );
}
