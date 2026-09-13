import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadOrCreateIdentity, getIdentity } from '../crypto/keys';
import { registerUser } from '../services/api';
import { importEncryptedIdentity } from '../crypto/backup';
import QRCodeDisplay from '../components/QRCodeDisplay';

export default function IdentitySetup() {
  const [step, setStep] = useState('input'); // 'input' | 'generating' | 'done'
  const [displayName, setDisplayName] = useState('');
  const [identity, setIdentity] = useState(null);
  const [error, setError] = useState(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreContent, setRestoreContent] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if identity already exists
    const existing = getIdentity();
    if (existing) {
      setIdentity(existing);
      setDisplayName(existing.displayName);
      setStep('done');
    }
  }, []);

  const handleGenerate = async () => {
    const cleaned = displayName.trim().replace(/[<>]/g, '').slice(0, 32);
    if (!cleaned) {
      setError('Please enter a valid display name (max 32 chars)');
      return;
    }

    setStep('generating');
    setError(null);

    try {
      await new Promise(r => setTimeout(r, 1200));

      const newIdentity = await loadOrCreateIdentity(cleaned);
      setIdentity(newIdentity);

      // Register public keys with the relay server
      try {
        await registerUser(
          newIdentity.userId,
          newIdentity.publicKey,
          newIdentity.displayName,
          newIdentity.signingPublicKey
        );
      } catch (err) {
        console.warn('Server registration deferred:', err.message);
      }

      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('input');
    }
  };

  const handleRestore = async () => {
    setError(null);
    if (!restoreContent.trim()) {
      setError('Please select or paste your encrypted backup JSON');
      return;
    }
    if (!restorePassphrase) {
      setError('Please enter your backup passphrase');
      return;
    }

    try {
      setRestoreLoading(true);
      const restored = await importEncryptedIdentity(restoreContent.trim(), restorePassphrase);

      // Try re-registering restored identity with server
      try {
        await registerUser(
          restored.identity.userId,
          restored.identity.publicKey,
          restored.identity.displayName,
          restored.identity.signingPublicKey
        );
      } catch (e) {
        console.warn('Server sync deferred:', e.message);
      }

      setIdentity(restored.identity);
      setDisplayName(restored.identity.displayName);
      setShowRestoreModal(false);
      navigate('/contacts');
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setRestoreContent(event.target.result);
    };
    reader.readAsText(file);
  };

  const handleContinue = () => {
    navigate('/contacts');
  };

  if (step === 'generating') {
    return (
      <div className="page identity-page">
        <div className="identity-generating">
          <div className="key-animation">
            <div className="key-ring"></div>
            <div className="key-ring delay-1"></div>
            <div className="key-ring delay-2"></div>
            <span className="key-icon">🔑</span>
          </div>
          <h2>Generating cryptographic identity...</h2>
          <p className="subtitle">
            Creating dual keypairs: X25519 for encryption & Ed25519 for tamper-proof signatures
          </p>
        </div>
      </div>
    );
  }

  if (step === 'done' && identity) {
    return (
      <div className="page identity-page">
        <div className="identity-card glass-panel">
          <div className="identity-header">
            <div className="shield-icon">🛡️</div>
            <h1>Identity Created</h1>
            <p className="subtitle">Your keys are isolated within this device&apos;s sandbox</p>
          </div>

          <div className="identity-details">
            <div className="identity-field">
              <label>Display Name</label>
              <span className="value">{identity.displayName}</span>
            </div>
            <div className="identity-field">
              <label>User ID (Fingerprint)</label>
              <span className="value mono">{identity.userId}</span>
            </div>
            <div className="identity-field">
              <label>Public Key (X25519)</label>
              <span className="value mono small">
                {identity.publicKey.substring(0, 24)}...
              </span>
            </div>
            <div className="identity-field">
              <label>Device Restriction</label>
              <span className="value safe">This device only (Single-device zero-knowledge)</span>
            </div>
          </div>

          <div className="identity-qr">
            <QRCodeDisplay
              userId={identity.userId}
              publicKey={identity.publicKey}
              displayName={identity.displayName}
              size={160}
            />
          </div>

          <div className="identity-notice">
            <span className="notice-icon">ℹ️</span>
            <span>
              Your private keys never leave this device. Forward secrecy and safety numbers protect all chats against MITM attacks.
            </span>
          </div>

          <button className="btn btn-primary" onClick={handleContinue}>
            Continue to Contacts →
          </button>
        </div>
      </div>
    );
  }

  // Input step
  return (
    <div className="page identity-page">
      <div className="identity-welcome glass-panel">
        <div className="logo-section">
          <div className="logo-icon">◈</div>
          <h1>CipherMesh</h1>
          <p className="tagline">Zero-Knowledge Encrypted Mesh Messaging</p>
        </div>

        <div className="setup-form">
          <h2>Create Your Identity</h2>
          <p className="subtitle">
            A cryptographic keypair is generated directly in your browser.
            No accounts, no email, no phone numbers, zero tracking.
          </p>

          <div className="input-group">
            <label htmlFor="display-name">Display Name</label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Choose a display name"
              maxLength={32}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="btn-column">
            <button className="btn btn-primary" onClick={handleGenerate}>
              Generate Identity 🔐
            </button>
            <button
              className="btn btn-secondary btn-sm mt-2"
              onClick={() => setShowRestoreModal(true)}
            >
              📥 Or Restore from Encrypted Backup
            </button>
          </div>

          <div className="privacy-note">
            <span className="note-icon">🔒</span>
            <span>
              Single-Device Architecture: Your identity is tied exclusively to this browser storage. You can export a password-protected backup anytime in Settings.
            </span>
          </div>
        </div>
      </div>

      {showRestoreModal && (
        <div className="modal-backdrop" onClick={() => setShowRestoreModal(false)}>
          <div className="modal-card glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Restore Identity Backup</h3>
              <button className="btn-icon close-btn" onClick={() => setShowRestoreModal(false)}>✕</button>
            </div>
            <p className="modal-subtitle">
              Select your <code>.json</code> encrypted backup file and provide your passphrase.
            </p>

            <div className="input-group">
              <label>Backup File (.json)</label>
              <input type="file" accept=".json" onChange={handleFileUpload} />
            </div>

            <div className="input-group">
              <label>Passphrase</label>
              <input
                type="password"
                value={restorePassphrase}
                onChange={e => setRestorePassphrase(e.target.value)}
                placeholder="Enter passphrase..."
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleRestore}
                disabled={restoreLoading || !restorePassphrase}
              >
                {restoreLoading ? 'Restoring...' : 'Restore & Enter'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowRestoreModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
