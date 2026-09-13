import { useState, useEffect } from 'react';
import { generateSafetyNumber, getIdentity } from '../crypto/keys';
import { verifyContact } from '../store/contacts';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, ShieldAlert, Info, X, Check } from 'lucide-react';

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
      <div className="modal-card safety-number-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <ShieldCheck size={22} color="#5B6EF5" />
            <h3>Verify Safety Numbers</h3>
          </div>
          <button className="btn-icon close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="modal-subtitle">
          Compare this 60-digit safety number with <strong>{contact.display_name}</strong> to guarantee no third party (or compromised relay) has swapped your public keys.
        </p>

        {contact.keyChanged && (
          <div className="alert-banner warning">
            <ShieldAlert size={18} color="#EF4444" />
            <span>
              <strong>Security Alert:</strong> This contact&apos;s public key was recently replaced. Re-verify before continuing your chat.
            </span>
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
                  bgColor="#FFFFFF"
                  fgColor="#1E293B"
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
          <Info size={16} color="#5B6EF5" />
          <span>Both you and {contact.display_name} will see the exact same 60 numbers. If numbers match on both screens, your conversation is 100% end-to-end encrypted.</span>
        </div>

        <div className="modal-actions">
          <button
            className={`btn ${isVerified ? 'btn-success' : 'btn-accent'}`}
            onClick={handleToggleVerified}
          >
            {isVerified ? (
              <>
                <Check size={16} />
                <span>Verified (Click to Revoke)</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Mark as Verified</span>
              </>
            )}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
