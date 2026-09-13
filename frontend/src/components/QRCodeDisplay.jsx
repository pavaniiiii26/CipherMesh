import { QRCodeSVG } from 'qrcode.react';

/**
 * Renders a QR code containing the user's identity payload.
 * The payload includes user_id, public_key, signing_public_key, and display_name
 */
export default function QRCodeDisplay({ userId, publicKey, signingPublicKey, displayName, size = 200 }) {
  const payload = JSON.stringify({
    user_id: userId,
    public_key: publicKey,
    signing_public_key: signingPublicKey,
    display_name: displayName,
  });

  return (
    <div className="qr-code-display">
      <div className="qr-code-wrapper">
        <QRCodeSVG
          value={payload}
          size={size}
          level="M"
          bgColor="#FFFFFF"
          fgColor="#1E293B"
          includeMargin={false}
        />
      </div>
    </div>
  );
}
