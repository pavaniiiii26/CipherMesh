import { useState } from 'react';
import IdentityAvatar from './IdentityAvatar';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, Scan, Share2, ShieldCheck } from 'lucide-react';

export default function QRCodeCard({ identity, onScanClick }) {
  const [copied, setCopied] = useState(false);

  if (!identity) return null;

  const payload = JSON.stringify({
    user_id: identity.userId,
    public_key: identity.publicKey,
    signing_public_key: identity.signingPublicKey,
    display_name: identity.displayName,
  }, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `CipherMesh Identity - ${identity.displayName}`,
          text: payload,
        });
      } catch (err) {
        handleCopy();
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="qr-code-card-wrapper">
      {/* Top Centered Circular Profile Placeholder */}
      <div className="qr-profile-header">
        <IdentityAvatar
          name={identity.displayName}
          userId={identity.userId}
          size={72}
        />
        <h2 className="qr-profile-name">{identity.displayName}</h2>
        <div className="qr-profile-badge">
          <ShieldCheck size={14} color="#4F46E5" />
          <span>E2EE Public Identity</span>
        </div>
      </div>

      {/* Large White Rounded Card */}
      <div className="qr-white-card">
        <div className="qr-code-canvas">
          <QRCodeSVG
            value={payload}
            size={220}
            level="M"
            bgColor="#FFFFFF"
            fgColor="#1E1E2E"
            includeMargin={false}
          />
        </div>

        <div className="qr-card-info">
          <span className="qr-info-label">User ID Fingerprint</span>
          <code className="qr-user-id-mono">{identity.userId}</code>
        </div>
      </div>

      {/* Action Buttons Panel */}
      <div className="qr-actions-panel">
        <button className="qr-action-btn primary" onClick={handleShare}>
          <Share2 size={18} />
          <span>{copied ? 'Copied Payload!' : 'Share QR Code'}</span>
        </button>

        <button className="qr-action-btn secondary" onClick={handleCopy}>
          {copied ? <Check size={18} /> : <Copy size={18} />}
          <span>{copied ? 'Copied to Clipboard' : 'Copy Payload'}</span>
        </button>

        {onScanClick && (
          <button className="qr-action-btn outline" onClick={onScanClick}>
            <Scan size={18} />
            <span>Scan / Import QR</span>
          </button>
        )}
      </div>
    </div>
  );
}
