import { QRCodeSVG } from 'qrcode.react';

/**
 * Renders a QR code containing the user's identity payload.
 * The payload includes user_id, public_key, and display_name
 * so a scanner can add this user as a contact instantly.
 */
export default function QRCodeDisplay({ userId, publicKey, displayName, size = 200 }) {
  const payload = JSON.stringify({
    user_id: userId,
    public_key: publicKey,
    display_name: displayName,
  });

  return (
    <div className="qr-code-display">
      <div className="qr-code-wrapper">
        <QRCodeSVG
          value={payload}
          size={size}
          level="M"
          bgColor="transparent"
          fgColor="#00F0FF"
          includeMargin={false}
        />
      </div>
      <div className="qr-label">Scan to add as contact</div>
    </div>
  );
}
