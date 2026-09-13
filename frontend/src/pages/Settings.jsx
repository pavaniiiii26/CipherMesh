import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIdentity, deleteIdentity } from '../crypto/keys';
import { exportEncryptedIdentity, importEncryptedIdentity } from '../crypto/backup';
import PrivacyModeSelector from '../components/PrivacyModeSelector';
import IdentityAvatar from '../components/IdentityAvatar';
import {
  Settings as SettingsIcon,
  Shield,
  Key,
  Download,
  Upload,
  Trash2,
  Lock,
  FileText,
  Check,
  X,
  AlertTriangle,
  Info,
  Timer
} from 'lucide-react';

const SETTINGS_STORAGE_KEY = 'ciphermesh_settings';

export default function Settings() {
  const [privacyMode, setPrivacyMode] = useState('direct');
  const [sendTyping, setSendTyping] = useState(false);
  const [sendReadReceipts, setSendReadReceipts] = useState(false);
  const [defaultTtl, setDefaultTtl] = useState(0);
  const [identity, setIdentity] = useState(null);
  const [saveNote, setSaveNote] = useState(false);

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

  const handleExportBackup = async () => {
    setBackupError(null);
    if (!exportPassphrase || exportPassphrase.length < 6) {
      setBackupError('Passphrase must be at least 6 characters');
      return;
    }

    try {
      setIsExporting(true);
      const backupJson = await exportEncryptedIdentity(exportPassphrase);

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
      setBackupError(err.message || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async () => {
    setBackupError(null);
    if (!importFileContent.trim()) {
      setBackupError('Please select or paste backup file content');
      return;
    }
    if (!importPassphrase) {
      setBackupError('Please enter the decryption passphrase');
      return;
    }

    try {
      setIsImporting(true);
      const res = await importEncryptedIdentity(importFileContent.trim(), importPassphrase);
      setIdentity(res.identity);
      setBackupSuccess('Identity and contacts restored successfully!');
      setTimeout(() => {
        setShowImportModal(false);
        setImportPassphrase('');
        setImportFileContent('');
        setBackupSuccess(null);
        window.location.reload();
      }, 1500);
    } catch (err) {
      setBackupError(err.message || 'Decryption failed — wrong passphrase or corrupted file');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setImportFileContent(evt.target?.result || '');
    };
    reader.readAsText(file);
  };

  const handleDeleteIdentity = () => {
    if (confirm('WARNING: Deleting your identity will purge your private keys. Export a backup first! Continue?')) {
      deleteIdentity();
      navigate('/');
    }
  };

  return (
    <div className="page settings-page-container">
      <div className="page-header-row">
        <div>
          <h1 className="page-main-title">Settings & Privacy</h1>
          <p className="page-subtitle">Configure encryption, network metadata policies, and identity backups</p>
        </div>
        {saveNote && (
          <div className="settings-saved-badge">
            <Check size={14} />
            <span>Saved</span>
          </div>
        )}
      </div>

      {identity && (
        <div className="settings-section-card">
          <div className="card-header-row">
            <Key size={20} color="#5B6EF5" />
            <h2>Cryptographic Identity</h2>
          </div>

          <div className="identity-overview-box">
            <IdentityAvatar name={identity.displayName} userId={identity.userId} size={54} />
            <div className="identity-details">
              <h3 className="identity-title">{identity.displayName}</h3>
              <div className="detail-line">
                <span className="label">User ID (Fingerprint):</span>
                <code className="mono">{identity.userId}</code>
              </div>
              <div className="detail-line">
                <span className="label">Public Key (X25519):</span>
                <code className="mono truncate">{identity.publicKey}</code>
              </div>
              {identity.signingPublicKey && (
                <div className="detail-line">
                  <span className="label">Signing Key (Ed25519):</span>
                  <code className="mono truncate">{identity.signingPublicKey}</code>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Network Privacy Mode */}
      <div className="settings-section-card">
        <PrivacyModeSelector value={privacyMode} onChange={handlePrivacyChange} />
      </div>

      {/* Metadata Policies */}
      <div className="settings-section-card">
        <div className="card-header-row">
          <Shield size={20} color="#5B6EF5" />
          <h2>Metadata & Messaging Policies</h2>
        </div>

        <div className="toggle-setting-row">
          <div className="setting-info">
            <div className="setting-title">Typing Indicators</div>
            <div className="setting-desc">
              Broadcast when you are typing to active chat recipients (disabled by default to prevent timing leak metadata).
            </div>
          </div>
          <label className="switch-toggle">
            <input
              type="checkbox"
              checked={sendTyping}
              onChange={(e) => handleToggleTyping(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        <div className="toggle-setting-row">
          <div className="setting-info">
            <div className="setting-title">Read Receipts</div>
            <div className="setting-desc">
              Send read receipt notifications when you open a contact&apos;s message thread.
            </div>
          </div>
          <label className="switch-toggle">
            <input
              type="checkbox"
              checked={sendReadReceipts}
              onChange={(e) => handleToggleReadReceipts(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        <div className="select-setting-row">
          <div className="setting-info">
            <div className="setting-title">Default Disappearing Messages Timer</div>
            <div className="setting-desc">
              Global TTL applied automatically to new messages.
            </div>
          </div>
          <select
            value={defaultTtl}
            onChange={(e) => handleChangeTtl(Number(e.target.value))}
            className="select-input"
          >
            <option value={0}>Off (Manual Purge)</option>
            <option value={30}>30 Seconds</option>
            <option value={300}>5 Minutes</option>
            <option value={3600}>1 Hour</option>
            <option value={86400}>24 Hours</option>
          </select>
        </div>
      </div>

      {/* Identity Backup & Export */}
      <div className="settings-section-card">
        <div className="card-header-row">
          <Download size={20} color="#5B6EF5" />
          <h2>Encrypted Backup & Migration</h2>
        </div>

        <p className="card-desc-text">
          Export your identity keypairs and contacts encrypted with PBKDF2 (100,000 rounds) and AES-256-GCM.
        </p>

        <div className="btn-row-flex">
          <button className="btn btn-indigo" onClick={() => setShowExportModal(true)}>
            <Download size={16} />
            <span>Export Backup</span>
          </button>
          <button className="btn btn-outline" onClick={() => setShowImportModal(true)}>
            <Upload size={16} />
            <span>Restore Backup</span>
          </button>
          <button className="btn btn-danger" onClick={handleDeleteIdentity}>
            <Trash2 size={16} />
            <span>Delete Identity</span>
          </button>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-backdrop" onClick={() => setShowExportModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Export Encrypted Backup</h3>
              <button className="btn-icon" onClick={() => setShowExportModal(false)}><X size={18} /></button>
            </div>
            <p className="modal-sub">Choose a passphrase to encrypt your secret identity keys.</p>

            <div className="field-group">
              <label className="field-label">Passphrase (min 6 chars)</label>
              <input
                type="password"
                value={exportPassphrase}
                onChange={e => setExportPassphrase(e.target.value)}
                placeholder="Enter strong passphrase..."
                className="text-input"
              />
            </div>

            {backupError && <div className="badge-error-banner">{backupError}</div>}
            {backupSuccess && <div className="badge-success-banner">{backupSuccess}</div>}

            <div className="modal-actions">
              <button className="btn btn-indigo" onClick={handleExportBackup} disabled={isExporting}>
                {isExporting ? 'Encrypting...' : 'Generate Backup File'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowExportModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Restore Encrypted Backup</h3>
              <button className="btn-icon" onClick={() => setShowImportModal(false)}><X size={18} /></button>
            </div>

            <div className="field-group">
              <label className="field-label">Backup File (.json)</label>
              <input type="file" accept=".json" onChange={handleFileUpload} className="file-input" />
            </div>

            <div className="field-group">
              <label className="field-label">Decryption Passphrase</label>
              <input
                type="password"
                value={importPassphrase}
                onChange={e => setImportPassphrase(e.target.value)}
                placeholder="Enter passphrase..."
                className="text-input"
              />
            </div>

            {backupError && <div className="badge-error-banner">{backupError}</div>}
            {backupSuccess && <div className="badge-success-banner">{backupSuccess}</div>}

            <div className="modal-actions">
              <button className="btn btn-indigo" onClick={handleImportBackup} disabled={isImporting}>
                {isImporting ? 'Decrypting...' : 'Restore Identity'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
