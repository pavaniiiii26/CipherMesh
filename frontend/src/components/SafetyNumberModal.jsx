import { useState, useEffect } from 'react';
import { generateSafetyNumber, getIdentity } from '../crypto/keys';
import { verifyContact } from '../store/contacts';
import { QRCodeSVG } from 'qrcode.react';

export default function SafetyNumberModal({ contact, onClose, onVerificationChange }) {
  const [safetyNumber, setSafetyNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isVerified, setIsVerified] = useState(contact.verified || false);
  const identity = getIdentity();

  useEffect(() => {
    async function compute() {
      if (identity && contact) {
        setLoading(true);
        const sn = await generateSafetyNumber(identity.publicKey, contact.public_key);
        setSafetyNumber(sn);
        setLoading(false);
      }
    }
    compute();
  }, [identity, contact]);

  const handleToggleVerified = () => {
    const next = !isVerified;
    setIsVerified(next);
    verifyContact(contact.user_id, next);
    if (onVerificationChange) {
      onVerificationChange(next);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card glass-panel safety-number-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon">🛡️</span>
            <h3>Verify Safety Numbers</h3>
          </div>
          <button className="btn-icon close-btn" onClick={onClose}>✕</button>
        </div>

        <p className="modal-subtitle">
          Compare this 60-digit safety number with <strong>{contact.display_name}</strong> to guarantee no third party (or compromised relay) has swapped your public keys.
        </p>

        {contact.keyChanged && (
          <div className="alert-banner warning">
            ⚠️ <strong>Security Alert:</strong> This contact&apos;s public key was recently replaced. You should re-verify this safety number before continuing your chat!
          </div>
        )}

        <div className="safety-number-display">
          {loading ? (
            <div className="loading-spinner">Generating cryptographic fingerprint...</div>
          ) : (
            <>
              <div className="safety-qr-box">
                <QRCodeSVG
                  value={`ciphermesh:safety:${safetyNumber?.formatted}`}
                  size={140}
                  bgColor="#0b0f19"
                  fgColor="#00f0ff"
                  level="M"
                />
              </div>

              <div className="safety-digits-grid">
                {safetyNumber?.blocks.map((block, idx) => (
                  <span key={idx} className="digit-block mono">
                    {block}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="safety-explanation">
          <span>💡 How it works:</span> Both you and {contact.display_name} will see the exact same 60 numbers. If the numbers match on both screens, your conversation is 100% end-to-end encrypted and immune to man-in-the-middle attacks.
        </div>

        <div className="modal-actions">
          <button
            className={`btn ${isVerified ? 'btn-success' : 'btn-accent'}`}
            onClick={handleToggleVerified}
          >
            {isVerified ? '✓ Identity Verified (Click to Revoke)' : '🛡️ Mark as Verified'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
