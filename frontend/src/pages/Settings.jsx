import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity, deleteIdentity } from '../crypto/keys';
import { exportEncryptedIdentity, importEncryptedIdentity } from '../crypto/backup';
import PrivacyModeSelector from '../components/PrivacyModeSelector';

const SETTINGS_STORAGE_KEY = 'ciphermesh_settings';

export default function Settings() {
  const [privacyMode, setPrivacyMode] = useState('direct');
  const [sendTyping, setSendTyping] = useState(false);
  const [sendReadReceipts, setSendReadReceipts] = useState(false);
  const [defaultTtl, setDefaultTtl] = useState(0);
  const [identity, setIdentity] = useState(null);
  const [saveNote, setSaveNote] = useState(false);

  // Backup & Restore states
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importFileContent, setImportFileContent] = useState('');
  const [backupError, setBackupError] = useState(null);
  const [backupSuccess, setBackupSuccess] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const id = getIdentity();
    setIdentity(id);

    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
      if (stored.privacyMode) setPrivacyMode(stored.privacyMode);
      if (stored.sendTyping !== undefined) setSendTyping(stored.sendTyping);
      if (stored.sendReadReceipts !== undefined) setSendReadReceipts(stored.sendReadReceipts);
      if (stored.defaultTtl !== undefined) setDefaultTtl(stored.defaultTtl);
    } catch {
      // default
    }
  }, []);

  const saveSetting = (updates) => {
    const existing = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    const merged = { ...existing, ...updates };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    setSaveNote(true);
    setTimeout(() => setSaveNote(false), 2000);
  };

  const handlePrivacyChange = (newMode) => {
    setPrivacyMode(newMode);
    saveSetting({ privacyMode: newMode });
  };

  const handleToggleTyping = (val) => {
    setSendTyping(val);
    saveSetting({ sendTyping: val });
  };

  const handleToggleReadReceipts = (val) => {
    setSendReadReceipts(val);
    saveSetting({ sendReadReceipts: val });
  };

  const handleChangeTtl = (val) => {
    setDefaultTtl(val);
    saveSetting({ defaultTtl: val });
  };

  // Export encrypted backup handler
  const handleExportBackup = async () => {
    setBackupError(null);
    if (!exportPassphrase || exportPassphrase.length < 6) {
      setBackupError('Passphrase must be at least 6 characters');
      return;
    }

    try {
      setIsExporting(true);
      const backupJson = await exportEncryptedIdentity(exportPassphrase);

      // Trigger download
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ciphermesh-backup-${identity.userId.substring(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setBackupSuccess('Encrypted backup generated and downloaded!');
      setTimeout(() => {
        setShowExportModal(false);
        setExportPassphrase('');
        setBackupSuccess(null);
      }, 1800);
    } catch (err) {
      setBackupError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Import encrypted backup handler
  const handleImportBackup = async () => {
    setBackupError(null);
    if (!importFileContent.trim()) {
      setBackupError('Please select or paste your backup JSON file');
      return;
    }
    if (!importPassphrase) {
      setBackupError('Please enter your passphrase');
      return;
    }

    try {
      setIsImporting(true);
      await importEncryptedIdentity(importFileContent.trim(), importPassphrase);
      setBackupSuccess('Identity and contacts restored successfully! Reloading...');
      setTimeout(() => {
        navigate('/contacts');
        window.location.reload();
      }, 1200);
    } catch (err) {
      setBackupError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImportFileContent(event.target.result);
    };
    reader.readAsText(file);
  };

  const handleDeleteIdentity = () => {
    if (confirm('CRITICAL ACTION: This will permanently delete your private keys, contacts, and all message histories stored on this device. Are you completely sure?')) {
      deleteIdentity();
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      localStorage.removeItem('ciphermesh_group_keys');
      navigate('/');
      window.location.reload();
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-header">
        <div>
          <h1>Settings & Privacy</h1>
          <p className="subtitle">Configure encryption parameters, metadata controls, and identity backups</p>
        </div>
        {saveNote && <div className="success-badge">✓ Setting saved</div>}
      </div>

      {/* Multi-device architecture disclosure */}
      <div className="settings-section glass-panel notice-box">
        <div className="notice-icon">📱</div>
        <div className="notice-content">
          <h4>Single-Device Zero-Knowledge Design</h4>
          <p>
            Your cryptographic keys exist exclusively on this device/browser sandbox. Multi-device sync is intentionally omitted to prevent server-side key synchronization vulnerabilities and maintain strict zero-knowledge integrity.
          </p>
        </div>
      </div>

      {/* Network Privacy & Routing Modes */}
      <div className="settings-section glass-panel">
        <PrivacyModeSelector value={privacyMode} onChange={handlePrivacyChange} />

        {/* Anonymous Mode Realistic Disclosure */}
        <div className="crypto-audit-note mt-3">
          <span>🛡️ Anonymous Mode Disclosure:</span> In this prototype, Anonymous Mode routes packets through an intermediate relay hop with synthetic random timing delay (0.5s – 2.0s) to emulate traffic-analysis resistance. In production, this would be backed by true onion-routed <strong>Tor Hidden Services (v3)</strong> or the <strong>Nym Mixnet</strong>.
        </div>
      </div>

      {/* Privacy & Metadata Leakage Controls */}
      <div className="settings-section glass-panel">
        <h3>Metadata & Privacy Controls</h3>
        <p className="subtitle">Configure features that may leak communication timing or metadata</p>

        <div className="settings-toggle-list">
          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-title">Typing Indicators</span>
              <span className="toggle-desc">
                Broadcast real-time typing state to recipients while composing a message.
              </span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={sendTyping}
                onChange={(e) => handleToggleTyping(e.target.checked)}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-title">Read Receipts</span>
              <span className="toggle-desc">
                Notify senders with blue double ticks when you open their messages. <em>Disabling this prevents reading timestamp metadata leakage.</em>
              </span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={sendReadReceipts}
                onChange={(e) => handleToggleReadReceipts(e.target.checked)}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-title">Default Disappearing Messages (TTL)</span>
              <span className="toggle-desc">
                Automatically purge messages on client and relay server after the specified expiration time.
              </span>
            </div>
            <select
              value={defaultTtl}
              onChange={(e) => handleChangeTtl(Number(e.target.value))}
              className="ttl-select"
            >
              <option value={0}>Off (Never)</option>
              <option value={30}>30 Seconds</option>
              <option value={300}>5 Minutes</option>
              <option value={3600}>1 Hour</option>
              <option value={86400}>24 Hours</option>
            </select>
          </div>
        </div>
      </div>

      {/* Cryptographic Identity & Backup */}
      {identity && (
        <div className="settings-section glass-panel">
          <div className="section-header-row">
            <h3>Cryptographic Identity & Keys</h3>
            <div className="btn-row">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowExportModal(true)}>
                🔐 Export Encrypted Backup
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowImportModal(true)}>
                📥 Restore Backup
              </button>
            </div>
          </div>

          <div className="identity-info-list">
            <div className="info-row">
              <span className="info-label">Display Name</span>
              <span className="info-val">{identity.displayName}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Fingerprint (User ID)</span>
              <span className="info-val mono">{identity.userId}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Encryption Key (X25519)</span>
              <span className="info-val mono break-all">{identity.publicKey}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Signing Key (Ed25519)</span>
              <span className="info-val mono break-all">{identity.signingPublicKey || 'Active'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Private Key Protection</span>
              <span className="info-val safe">Local Browser Sandbox (never leaves device)</span>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div className="settings-section glass-panel danger-zone">
        <h3>Danger Zone</h3>
        <p className="subtitle">
          Permanently purge local identity and delete cryptographic keys and chat history from this device.
        </p>
        <button className="btn btn-danger" onClick={handleDeleteIdentity}>
          Wipe Local Identity & Keys
        </button>
      </div>

      {/* Export Backup Modal */}
      {showExportModal && (
        <div className="modal-backdrop" onClick={() => setShowExportModal(false)}>
          <div className="modal-card glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Export Encrypted Backup</h3>
              <button className="btn-icon close-btn" onClick={() => setShowExportModal(false)}>✕</button>
            </div>
            <p className="modal-subtitle">
              Choose a strong passphrase to encrypt your private keys and contacts using AES-256-GCM + PBKDF2 (100,000 rounds).
            </p>

            <div className="input-group">
              <label>Passphrase (minimum 6 characters)</label>
              <input
                type="password"
                value={exportPassphrase}
                onChange={e => setExportPassphrase(e.target.value)}
                placeholder="Enter a strong passphrase..."
                autoFocus
              />
            </div>

            {backupError && <div className="error-message">{backupError}</div>}
            {backupSuccess && <div className="success-message">{backupSuccess}</div>}

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleExportBackup}
                disabled={isExporting || exportPassphrase.length < 6}
              >
                {isExporting ? 'Encrypting...' : 'Download Encrypted Backup (.json)'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowExportModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Backup Modal */}
      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="modal-card glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Restore Identity from Backup</h3>
              <button className="btn-icon close-btn" onClick={() => setShowImportModal(false)}>✕</button>
            </div>
            <p className="modal-subtitle">
              Upload your encrypted backup file (.json) and enter the passphrase used to create it.
            </p>

            <div className="input-group">
              <label>Backup File</label>
              <input type="file" accept=".json" onChange={handleFileUpload} />
            </div>

            <div className="input-group">
              <label>Passphrase</label>
              <input
                type="password"
                value={importPassphrase}
                onChange={e => setImportPassphrase(e.target.value)}
                placeholder="Enter the passphrase..."
              />
            </div>

            {backupError && <div className="error-message">{backupError}</div>}
            {backupSuccess && <div className="success-message">{backupSuccess}</div>}

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleImportBackup}
                disabled={isImporting || !importPassphrase}
              >
                {isImporting ? 'Decrypting & Restoring...' : 'Restore Identity'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

