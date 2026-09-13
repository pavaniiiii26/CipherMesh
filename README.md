# CipherMesh — Privacy-Focused Encrypted Messaging Prototype

CipherMesh is a prototype of an end-to-end (E2E) encrypted messaging application built with a **Python FastAPI** relay backend and a **React (JS)** frontend. 

The relay server operates under a **zero-knowledge relay architecture**:
- The server **never stores private keys** or touches plaintext messages.
- The server stores only public keys and metadata, and acts solely as an encrypted blob router.
- All cryptographic key generation, encryption, and decryption happen client-side in the user's browser using `tweetnacl-js` (libsodium / NaCl bindings).

---

## Architecture Overview

```
[ User A: Browser ]
   │
   ├─ X25519 Keypair (Generated & stored locally)
   ├─ Encrypts message with Recipient's Public Key (nacl.box)
   │
   ▼
[ FastAPI WebSocket Relay Server ]
   │
   ├─ Receives opaque encrypted payload + nonce
   ├─ CANNOT decrypt or inspect message payload
   ├─ Routes to Recipient via WebSocket (or stores temporarily if offline)
   │
   ▼
[ User B: Browser ]
   │
   ├─ Receives encrypted payload + nonce
   └─ Decrypts using own Private Key + Sender Public Key (nacl.box.open)
```

---

## Features Implemented

1. **User Identity & Key Management**
   - Client generates an **X25519 Diffie-Hellman** keypair on first launch.
   - User ID is derived client-side as a SHA-256 fingerprint of the public key.
   - Private keys remain strictly inside browser storage and never touch the server.

2. **Contacts & QR Code Onboarding**
   - Users can display their public identity QR code encoding `{ user_id, public_key, display_name }`.
   - Add contacts by scanning or pasting the JSON payload.
   - Contacts are stored client-side in localStorage (server has no contact graph).
   - Real-time online/offline presence tracking via WebSockets.

3. **1:1 End-to-End Encrypted Messaging**
   - Authenticated encryption using `nacl.box` (X25519 + XSalsa20-Poly1305).
   - Fast real-time delivery over WebSockets.
   - Automatic fallback to HTTP polling if WebSocket is offline.
   - Offline message queue that flushes automatically upon reconnection.

4. **Encrypted Group Chats**
   - Multi-user groups protected by a **sender-keys scheme**:
     - The creator generates a 256-bit symmetric group key.
     - The group key is individually encrypted for each member using their public key (`nacl.box`).
     - Group messages are encrypted symmetrically via `nacl.secretbox`.
   - *Production note*: Marked in code comments for future upgrade to Messaging Layer Security (MLS, RFC 9420).

5. **Network Privacy Modes (Simulated)**
   - **Direct**: Instant relay routing.
   - **Relay**: Intermediate hop for metadata abstraction.
   - **Anonymous**: Adds an extra relay hop and simulated timing delay to emulate onion routing/mixnets.

6. **Presence & Resilient Connectivity**
   - Real-time connection status banner (`Connecting`, `Connected (E2E)`, `Offline`, `Error`).
   - Typing indicators and message delivery acknowledgments.
   - Local queuing of messages during network dropouts.

---

## Project Structure

```
CipherMesh/
├── backend/
│   ├── requirements.txt
│   ├── run.py                     # Uvicorn server entrypoint
│   └── app/
│       ├── __init__.py
│       ├── main.py                # FastAPI app, CORS, lifespan, WS endpoint
│       ├── database.py            # Async SQLite layer (public keys & encrypted blobs)
│       ├── websocket_hub.py       # WebSocket connection manager & relay hub
│       └── routes/
│           ├── users.py           # Public key registration & lookup
│           ├── contacts.py        # Public key resolution
│           ├── groups.py          # Group metadata & encrypted key distribution
│           └── messages.py        # Offline message retrieval (polling fallback)
│
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx                # Global state, router, background message decryption
        ├── index.css              # Cyberpunk dark mode design system
        ├── crypto/
        │   ├── keys.js            # Keypair generation, nacl.box encrypt/decrypt
        │   └── groupCrypto.js     # Group sender-keys (nacl.secretbox)
        ├── services/
        │   ├── api.js             # REST client
        │   └── websocket.js       # WebSocket client with exponential backoff & queue
        ├── store/
        │   ├── contacts.js        # Local contacts storage
        │   └── messages.js        # Local message storage
        ├── components/
        │   ├── Navbar.jsx         # Header with identity indicator
        │   ├── ConnectionStatus.jsx # Connection state banner
        │   ├── MessageBubble.jsx  # Chat bubble with delivery status
        │   ├── ContactItem.jsx    # Contact row with presence dot
        │   ├── QRCodeDisplay.jsx  # QR code renderer
        │   └── PrivacyModeSelector.jsx # Privacy mode selector
        └── pages/
            ├── IdentitySetup.jsx  # Keypair generation UI
            ├── Contacts.jsx       # Contact list & add contact modal
            ├── Chat.jsx           # 1:1 and group chat screen
            ├── Groups.jsx         # Group creation & key distribution
            ├── QRPage.jsx         # QR display & scan/import
            └── Settings.jsx       # Privacy modes & local key wiping
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

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```
*Frontend runs on `http://localhost:5173`.*

---

## Testing Multi-User E2EE Messaging

1. Open **Browser Tab 1** (`http://localhost:5173`):
   - Enter a display name (e.g., `Alice`) and click **Generate Identity**.
   - Navigate to the **QR Code** page and click **Copy Raw Payload**.

2. Open **Browser Tab 2** (in an **Incognito Window** or second browser):
   - Enter a display name (e.g., `Bob`) and click **Generate Identity**.
   - Navigate to **Contacts** -> **+ Add Contact** (or **QR Code** -> **Scan / Import**).
   - Paste Alice's payload and click **Import & Verify Contact**.

3. In Tab 2, tap on Alice to enter the chat:
   - Also copy Bob's payload and add Bob in Tab 1.
   - Send encrypted messages back and forth in real time!
   - Notice the connection states, typing indicators, and delivery ticks (`✓`, `✓✓`).

4. Inspect the Relay Database:
   - Check `backend/ciphermesh.db`: all message rows in the `messages` table contain solely base64 `encrypted_payload` and `nonce`. Plaintext never exists on the server!

---

## Production Security Roadmap

Every module includes explicit code comments identifying where production-grade systems require stronger primitives:

| Feature | Prototype Implementation | Production Replacement |
| :--- | :--- | :--- |
| **Key Storage** | Browser `localStorage` | WebCrypto non-extractable keys, hardware security module (HSM), or secure enclave |
| **Group Ratchet** | Sender-Keys (`nacl.secretbox`) | Messaging Layer Security (**MLS** / RFC 9420) or TreeKEM |
| **1:1 Forward Secrecy** | Static Diffie-Hellman (`nacl.box`) | **Double Ratchet Algorithm** (Signal Protocol) |
| **Anonymous Routing** | Simulated server delay & extra hop | Real **Tor Onion Services (v3)** or **Nym Mixnet** |
| **Contact Verification** | QR code fingerprint comparison | Cryptographic safety numbers & Key Transparency log |
| **Message Retention** | Ephemeral DB with delivery flags | In-memory Redis queue with hard TTL / zero server persistence once ACKed |
