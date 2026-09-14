# CipherMesh — Privacy-Focused Encrypted Messaging PROTOTYPE

CipherMesh is a hardened end-to-end (E2E) encrypted messaging application built with a **Python FastAPI** relay backend and a **React (JS)** frontend. 

The relay server operates under a strict **zero-knowledge relay architecture**:
- The server **never stores private keys** or touches plaintext messages.
- The server stores only public keys and metadata, and acts solely as an encrypted blob router.
- All cryptographic key generation, encryption, decryption, and digital signing happen client-side in the user's browser using `tweetnacl-js` (libsodium / NaCl bindings) and the Web Crypto API.

---

## Architecture Overview

```
[ User A: Browser ]
   │
   ├─ Dual Keypairs:
   │   ├─ Static X25519 (Key Exchange / Encryption)
   │   ├─ Static Ed25519 (Digital Signatures / Message Authenticity)
   │   └─ Ephemeral X25519 (Generated fresh per 1:1 message for Forward Secrecy)
   ├─ Encrypts with Recipient's Public Key + Ephemeral Key (nacl.box)
   ├─ Signs payload with Ed25519 Key (nacl.sign.detached)
   ├─ Generates fresh unique 24-byte Nonce
   │
   ▼
[ FastAPI WebSocket Relay Server ]
   │
   ├─ HTTP & WebSocket Rate Limiters (120 req/min HTTP, 15 msg/sec WS)
   ├─ Nonce Replay Protection Cache (rejects repeated nonces)
   ├─ CANNOT decrypt or inspect message payload
   ├─ Routes to Recipient via WebSocket (or stores temporarily if offline)
   ├─ Background Task: Sweeps expired TTL messages every 30s
   │
   ▼
[ User B: Browser ]
   │
   ├─ Validates Nonce against local replay cache
   ├─ Decrypts using Private Key + Ephemeral Public Key (nacl.box.open)
   ├─ Verifies Sender's Ed25519 Signature (group messages & 1:1)
   ├─ Safety Number Verification: 60-digit fingerprint comparison
   └─ Disappearing Messages: Auto-purges locally upon TTL expiration
```

---

## Security Primitives & Features

1. **Dual Identity & Key Management**
   - Client generates both an **X25519 Diffie-Hellman** keypair and an **Ed25519 Digital Signing** keypair on launch.
   - User ID is derived client-side as a SHA-256 fingerprint of the public key.
   - Private keys remain strictly inside browser storage and never touch the server.

2. **Cryptographic Safety Numbers & Key Verification**
   - 60-digit safety numbers computed via dual SHA-256 over lexicographically sorted public keys (matching Signal's approach).
   - In-app modal with formatted 12x5 digit blocks and QR code for in-person or out-of-band verification.
   - Verification status badge (`✓ Verified`) and warning alerts if a contact's public key changes unexpectedly (MITM detection).

3. **Forward Secrecy for 1:1 Chat**
   - 1-round ephemeral key exchange: Every 1:1 message generates a fresh ephemeral X25519 keypair.
   - Private ephemeral keys are discarded immediately from memory after encryption.
   - Compromise of long-term static identity keys does not retroactively decrypt past message history.

4. **Replay Protection**
   - Nonce validation enforced at both layers:
     - **Relay Server**: In-memory `SeenNoncesCache` tracking 24-byte nonces across sliding TTL windows.
     - **Client Store**: Message ID and nonce deduplication cache to block replay attacks if relay is untrusted.

5. **Message Integrity & Authenticity for Group Chat**
   - Symmetric group encryption via `nacl.secretbox` using 256-bit sender keys.
   - Each group message payload is digitally signed with the sender's **Ed25519 signing key** (`nacl.sign.detached`).
   - Group members verify the cryptographic signature against the sender's registered identity key before rendering, preventing impersonation.

6. **Disappearing Messages (Configurable TTL)**
   - Configurable per-chat or global message expiration: Off, 30 seconds, 5 minutes, 1 hour, 24 hours.
   - Real-time countdown timer displayed on chat bubbles.
   - Dual purge: Client store removes expired messages immediately; relay background worker periodically purges expired offline messages.

7. **Encrypted Identity Backup & Restore**
   - Export identity and contacts as a password-protected encrypted file (`ciphermesh-identity.cmbackup`).
   - Strong encryption using **PBKDF2 (100,000 rounds, SHA-256)** and **AES-256-GCM** via the Web Crypto API.
   - Safe migration across browsers and devices without transmitting unencrypted keys.

8. **Privacy-Preserving Toggles**
   - **Typing Indicators**: Opt-in toggle (defaults to **OFF** to avoid leaking behavioral timing metadata).
   - **Read Receipts**: Opt-in toggle (defaults to **OFF** to avoid leaking user activity patterns).

9. **Relay Rate Limiting & Abuse Prevention**
   - **HTTP Sliding Window Rate Limiter**: 120 requests/minute per IP address.
   - **WebSocket Connection Rate Limiter**: 15 messages/second per active connection to mitigate spam and DoS.

10. **Contact Audit Trail & Disclosures**
    - Audit log on each contact capturing addition timestamp and onboarding source (`qr_scan`, `manual_id`, `import`).
    - Clear UI disclosures on browser-local storage boundaries and anonymous simulation limits.

---

## Project Structure

```
CipherMesh/
├── backend/
│   ├── requirements.txt
│   ├── run.py                     # Uvicorn server entrypoint
│   ├── tests/
│   │   └── test_relay_security.py # Automated security & relay test suite
│   └── app/
│       ├── __init__.py
│       ├── main.py                # FastAPI app, rate limiting, TTL sweeper, lifespan
│       ├── database.py            # SQLite schema with migrations, ephemeral keys & TTL purge
│       ├── websocket_hub.py       # WebSocket hub with replay protection & rate limiting
│       └── routes/
│           ├── users.py           # User registration (X25519 + Ed25519) & lookup
│           ├── contacts.py        # Public key resolution & display name sanitization
│           ├── groups.py          # Group metadata & encrypted key distribution
│           └── messages.py        # Offline message retrieval with TTL filter
│
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx                # Global state, router, background message decryption
        ├── index.css              # Cyberpunk dark mode design system & security badges
        ├── crypto/
        │   ├── keys.js            # Dual keypair, forward secrecy, safety numbers, signatures
        │   ├── groupCrypto.js     # Group secretbox + Ed25519 signature verification
        │   └── backup.js          # PBKDF2 + AES-256-GCM identity export/import
        ├── services/
        │   ├── api.js             # REST client
        │   └── websocket.js       # WebSocket client with auto-reconnect & queue
        ├── store/
        │   ├── contacts.js        # Local contacts storage & safety verification status
        │   └── messages.js        # Local message storage with TTL auto-purge & replay cache
        ├── components/
        │   ├── Navbar.jsx         # Header with identity indicator
        │   ├── ConnectionStatus.jsx # Connection state banner
        │   ├── MessageBubble.jsx  # Chat bubble with countdown timer & read ticks
        │   ├── ContactItem.jsx    # Contact row with verification shield & audit source
        │   ├── QRCodeDisplay.jsx  # QR code renderer
        │   ├── SafetyNumberModal.jsx # 60-digit fingerprint comparison modal
        │   └── PrivacyModeSelector.jsx # Privacy mode selector
        └── pages/
            ├── IdentitySetup.jsx  # Keypair generation & backup restore UI
            ├── Contacts.jsx       # Contact list, safety verification & add contact modal
            ├── Chat.jsx           # 1:1 and group chat with TTL selector & safety numbers
            ├── Groups.jsx         # Group creation & key distribution
            ├── QRPage.jsx         # QR display & scan/import
            └── Settings.jsx       # Privacy toggles, backup/export, and security disclosures
```

---

## Running the Application

### 1. Backend Setup

```bash
cd backend
pip install -r requirements.txt
python run.py
```
*Backend runs on `http://localhost:8000` (WebSocket at `ws://localhost:8000/ws/{user_id}`).*

### 2. Run Automated Security Verification Tests

```bash
cd backend
python tests/test_relay_security.py
```
*Runs 6 comprehensive test suites covering registration, replay prevention, rate limiting, ephemeral key forwarding, and TTL database sweeping.*

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```
*Frontend runs on `http://localhost:5173`.*

---

## Testing Multi-User Hardened E2EE

1. **Launch Two Identities**:
   - Tab 1: Open `http://localhost:5173`, create identity `Alice`.
   - Tab 2 (Incognito): Open `http://localhost:5173`, create identity `Bob`.

2. **Add Contact & Compare Safety Numbers**:
   - In Tab 1, go to **QR Code** -> click **Copy Raw Payload**.
   - In Tab 2, go to **Contacts** -> **+ Add Contact** -> paste payload and import.
   - Also add Bob into Alice's contacts.
   - In either chat, click the **Shield (🛡️)** icon in the header to open the **Safety Number**.
   - Verify that the 60-digit fingerprints match across both browsers, then toggle **Mark as Verified**.

3. **Verify Forward Secrecy & Ephemeral Keys**:
   - Send messages between Alice and Bob.
   - Inspect the network traffic in Developer Tools (or check `backend/ciphermesh.db`): each 1:1 message carries an `ephemeral_key` base64 string distinct from the sender's static public key.

4. **Test Disappearing Messages (TTL)**:
   - In the chat header, set the TTL timer to **30s**.
   - Send a message. Observe the live countdown timer on the message bubble (`⏱️ 30s`).
   - Once expired, the message disappears automatically from local state and cannot be recovered.

5. **Test Encrypted Backup & Restore**:
   - Go to **Settings** -> **Export Encrypted Backup**.
   - Enter a password and download `ciphermesh-identity.cmbackup`.
   - In a new incognito window, click **Restore from Encrypted Backup** on the setup screen to restore your identity and contacts seamlessly.

---

## Production Security Roadmap

| Feature | Prototype Implementation | Production Replacement |
| :--- | :--- | :--- |
| **Key Storage** | Browser `localStorage` | WebCrypto non-extractable keys, hardware security module (HSM), or OS Keyring |
| **1:1 Ratchet** | Ephemeral X25519 per-message | Full **Double Ratchet Algorithm** (Signal Protocol) with continuous KDF chain |
| **Group Ratchet** | Sender-Keys + Ed25519 signatures | Messaging Layer Security (**MLS** / RFC 9420) or TreeKEM |
| **Anonymous Routing** | Simulated server delay & extra hop | Production **Tor Onion Services (v3)** or **Nym Mixnet** |
| **Contact Verification** | 60-digit safety numbers | Key Transparency logs (e.g., CONIKS) + Safety Numbers |
| **Message Retention** | Ephemeral SQLite with TTL cleaner | In-memory Redis queue with hard TTL and instant memory zeroization |
