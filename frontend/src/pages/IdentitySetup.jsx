import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadOrCreateIdentity, getIdentity } from '../crypto/keys';
import { registerUser } from '../services/api';
import { importEncryptedIdentity } from '../crypto/backup';
import QRCodeCard from '../components/QRCodeCard';
import { Shield, Key, ArrowRight, Upload, Lock, Check } from 'lucide-react';

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
      await new Promise(r => setTimeout(r, 1000));
      const newIdentity = await loadOrCreateIdentity(cleaned);
      setIdentity(newIdentity);

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
    reader.onload = (evt) => {
      setRestoreContent(evt.target?.result || '');
    };
    reader.readAsText(file);
  };

  return (
    <div className="identity-setup-container">
      <div className="identity-setup-brand">
        <div className="brand-icon-box">
          <Shield size={44} color="#5B6EF5" />
        </div>
        <h1 className="brand-title">CipherMesh</h1>
        <p className="brand-sub">Zero-Knowledge Encrypted Messaging</p>
      </div>

      {step === 'input' && (
        <div className="identity-card-box">
          <h2>Create Cryptographic Identity</h2>
          <p className="card-sub">
            Generate client-side X25519 keypair for encryption and Ed25519 keypair for digital signatures.
          </p>

          <div className="field-group">
            <label className="field-label">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              placeholder="e.g. Alice"
              className="text-input"
              autoFocus
            />
          </div>

          {error && <div className="badge-error-banner">{error}</div>}

          <button className="btn btn-indigo full-width" onClick={handleGenerate}>
            <Key size={18} />
            <span>Generate Cryptographic Keypair</span>
          </button>

          <div className="restore-link-row">
            <button className="btn-link" onClick={() => setShowRestoreModal(true)}>
              <Upload size={16} />
              <span>Restore existing identity backup</span>
            </button>
          </div>
        </div>
      )}

      {step === 'generating' && (
        <div className="identity-card-box centered">
          <div className="generating-spinner-box">
            <Key size={32} className="spin-icon" color="#5B6EF5" />
          </div>
          <h3>Generating Identity Keys...</h3>
          <p className="card-sub">Creating entropy and deriving public fingerprint.</p>
        </div>
      )}

      {step === 'done' && identity && (
        <div className="identity-card-box centered">
          <QRCodeCard identity={identity} />

          <div className="setup-actions">
            <button className="btn btn-indigo full-width" onClick={() => navigate('/contacts')}>
              <span>Start Encrypted Chat</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {showRestoreModal && (
        <div className="modal-backdrop" onClick={() => setShowRestoreModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Restore Identity Backup</h3>
              <button className="btn-icon" onClick={() => setShowRestoreModal(false)}>✕</button>
            </div>

            <div className="field-group">
              <label className="field-label">Backup File (.json)</label>
              <input type="file" accept=".json" onChange={handleFileUpload} className="file-input" />
            </div>

            <div className="field-group">
              <label className="field-label">Passphrase</label>
              <input
                type="password"
                value={restorePassphrase}
                onChange={e => setRestorePassphrase(e.target.value)}
                placeholder="Enter passphrase..."
                className="text-input"
              />
            </div>

            {error && <div className="badge-error-banner">{error}</div>}

            <div className="modal-actions">
              <button className="btn btn-indigo" onClick={handleRestore} disabled={restoreLoading}>
                {restoreLoading ? 'Decrypting...' : 'Restore & Continue'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowRestoreModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
