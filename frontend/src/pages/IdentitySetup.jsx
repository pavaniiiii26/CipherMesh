import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadOrCreateIdentity, getIdentity } from '../crypto/keys';
import { registerUser } from '../services/api';
import QRCodeDisplay from '../components/QRCodeDisplay';

export default function IdentitySetup() {
  const [step, setStep] = useState('input'); // 'input' | 'generating' | 'done'
  const [displayName, setDisplayName] = useState('');
  const [identity, setIdentity] = useState(null);
  const [error, setError] = useState(null);
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
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setStep('generating');
    setError(null);

    try {
      // Small delay to show the animation
      await new Promise(r => setTimeout(r, 1500));

      const newIdentity = await loadOrCreateIdentity(displayName.trim());
      setIdentity(newIdentity);

      // Register public key with the relay server
      try {
        await registerUser(newIdentity.userId, newIdentity.publicKey, newIdentity.displayName);
      } catch (err) {
        console.warn('Server registration failed (server may be offline):', err.message);
        // Non-fatal — identity is created locally, server registration can retry later
      }

      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('input');
    }
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
          <h2>Generating your identity...</h2>
          <p className="subtitle">Creating X25519 keypair for end-to-end encryption</p>
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
            <p className="subtitle">Your keys are stored only on this device</p>
          </div>

          <div className="identity-details">
            <div className="identity-field">
              <label>Display Name</label>
              <span className="value">{identity.displayName}</span>
            </div>
            <div className="identity-field">
              <label>User ID</label>
              <span className="value mono">{identity.userId}</span>
            </div>
            <div className="identity-field">
              <label>Public Key</label>
              <span className="value mono small">
                {identity.publicKey.substring(0, 24)}...
              </span>
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
              Your private key never leaves this device. The server stores only
              your public key for message encryption.
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
          <p className="tagline">Private. Encrypted. Yours.</p>
        </div>

        <div className="setup-form">
          <h2>Create Your Identity</h2>
          <p className="subtitle">
            A cryptographic keypair will be generated on your device.
            No accounts, no phone numbers, no tracking.
          </p>

          <div className="input-group">
            <label htmlFor="display-name">Display Name</label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Choose a display name"
              maxLength={30}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button className="btn btn-primary" onClick={handleGenerate}>
            Generate Identity 🔐
          </button>

          <div className="privacy-note">
            <span className="note-icon">🔒</span>
            <span>
              Your private key is generated and stored locally. It is never
              sent to any server. End-to-end encryption by default.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
