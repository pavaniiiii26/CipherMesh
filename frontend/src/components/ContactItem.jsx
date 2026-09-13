export default function ContactItem({ contact, onClick, isActive }) {
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
        <div className="contact-name">{contact.display_name}</div>
        <div className="contact-id">{contact.user_id}</div>
      </div>
      <div className={`contact-status ${contact.online ? 'online' : 'offline'}`}>
        {contact.online ? 'Online' : 'Offline'}
      </div>
    </div>
  );
}
