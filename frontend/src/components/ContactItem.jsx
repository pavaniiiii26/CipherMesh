export default function ContactItem({ contact, onClick, onVerifyClick, isActive }) {
  const sourceLabels = {
    qr_scan: 'QR Scan',
    manual_id: 'User ID',
    group: 'Group Member',
    import: 'Backup Import',
  };

  const addedDate = contact.addedAt
    ? new Date(contact.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <div
      className={`contact-item ${isActive ? 'active' : ''}`}
      onClick={() => onClick(contact)}
    >
      <div className="contact-avatar">
        {contact.display_name?.charAt(0)?.toUpperCase() || '?'}
        <span className={`presence-dot ${contact.online ? 'online' : 'offline'}`} />
      </div>
      <div className="contact-info">
        <div className="contact-name-row">
          <span className="contact-name">{contact.display_name}</span>
          {contact.verified && (
            <span className="badge-shield verified" title="Identity verified via Safety Numbers">
              🛡️
            </span>
          )}
          {contact.keyChanged && (
            <span className="badge-shield warning" title="Contact's public key was recently replaced">
              ⚠️
            </span>
          )}
        </div>
        <div className="contact-audit-meta">
          <span className="contact-id mono">{contact.user_id}</span>
          {addedDate && (
            <span className="contact-added-text">
              • {sourceLabels[contact.source] || 'Added'} on {addedDate}
            </span>
          )}
        </div>
      </div>

      <div className="contact-trailing">
        <span className={`contact-status ${contact.online ? 'online' : 'offline'}`}>
          {contact.online ? 'Online' : 'Offline'}
        </span>
        {onVerifyClick && (
          <button
            className={`btn-verify-icon ${contact.verified ? 'verified' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onVerifyClick(contact);
            }}
            title={contact.verified ? 'Verified Safety Number' : 'Verify Safety Number'}
          >
            {contact.verified ? '✓ Verified' : 'Verify'}
          </button>
        )}
      </div>
    </div>
  );
}
