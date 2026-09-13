"""
CipherMesh — WebSocket Hub (Relay)

This is the core relay engine. It:
  1. Manages active WebSocket connections keyed by user_id
  2. Relays encrypted message blobs between clients — it CANNOT read them
  3. Broadcasts presence updates (online/offline)
  4. Simulates "anonymous" routing by adding an extra relay hop with delay

PRODUCTION NOTES:
  - "Anonymous" mode is a PLACEHOLDER. Real anonymous messaging requires
    Tor hidden services, mixnet protocols (e.g., Nym), or onion routing.
    The current implementation just adds a random delay to simulate indirection.
  - For scale, replace the in-memory connection dict with Redis pub/sub.
  - Add proper authentication (e.g., challenge-response with the user's keypair)
    instead of trusting the user_id query param.
  - Add rate limiting per connection to prevent abuse.
"""

import asyncio
import json
import random
import time
from fastapi import WebSocket, WebSocketDisconnect
from app import database as db


class SeenNoncesCache:
    """Tracks seen cryptographic nonces to prevent replay attacks."""

    def __init__(self, window_seconds: float = 600.0):
        self.window = window_seconds
        self._nonces: dict[str, float] = {}

    def is_replay_or_record(self, nonce: str) -> bool:
        """Returns True if the nonce was already observed within the sliding window."""
        now = time.time()
        # Periodically purge expired nonces
        if len(self._nonces) > 2000:
            self._nonces = {k: ts for k, ts in self._nonces.items() if now - ts < self.window}

        if nonce in self._nonces:
            if now - self._nonces[nonce] < self.window:
                return True

        self._nonces[nonce] = now
        return False


class ConnectionRateLimiter:
    """Sliding window rate limiter to prevent flooding."""

    def __init__(self, max_messages_per_second: int = 15):
        self.max_rate = max_messages_per_second
        self._activity: dict[str, list[float]] = {}

    def is_rate_limited(self, user_id: str) -> bool:
        now = time.time()
        timestamps = self._activity.setdefault(user_id, [])
        self._activity[user_id] = [t for t in timestamps if now - t < 1.0]
        if len(self._activity[user_id]) >= self.max_rate:
            return True
        self._activity[user_id].append(now)
        return False


class ConnectionManager:
    """Manages active WebSocket connections and message relay."""

    def __init__(self):
        # user_id -> WebSocket
        self.active_connections: dict[str, WebSocket] = {}
        # user_id -> set of user_ids who want presence updates
        self.presence_subscribers: dict[str, set[str]] = {}
        self.nonce_cache = SeenNoncesCache(window_seconds=600.0)
        self.rate_limiter = ConnectionRateLimiter(max_messages_per_second=15)

    async def connect(self, websocket: WebSocket, user_id: str):
        """Accept a WebSocket connection and register the user."""
        await websocket.accept()
        self.active_connections[user_id] = websocket

        # Broadcast that this user came online
        await self._broadcast_presence(user_id, "online")

        # Send any pending messages (from when user was offline)
        await self._flush_pending_messages(user_id)

    async def disconnect(self, user_id: str):
        """Remove a connection and broadcast offline status."""
        self.active_connections.pop(user_id, None)
        await self._broadcast_presence(user_id, "offline")

    def is_online(self, user_id: str) -> bool:
        return user_id in self.active_connections

    def get_online_users(self) -> list[str]:
        return list(self.active_connections.keys())

    async def handle_message(self, sender_id: str, data: dict):
        """
        Route an incoming message envelope from a connected client.

        The server does NOT decrypt encrypted_payload. It's an opaque blob.
        """
        # Connection rate limiting check
        if self.rate_limiter.is_rate_limited(sender_id):
            await self._send_to_user(sender_id, {
                "type": "error",
                "message": "Rate limit exceeded: too many messages per second. Slow down."
            })
            return

        msg_type = data.get("type", "message")

        if msg_type == "presence_subscribe":
            contact_ids = data.get("contact_ids", [])
            for cid in contact_ids:
                if cid not in self.presence_subscribers:
                    self.presence_subscribers[cid] = set()
                self.presence_subscribers[cid].add(sender_id)

            presence_states = {
                cid: "online" if self.is_online(cid) else "offline"
                for cid in contact_ids
            }
            await self._send_to_user(sender_id, {
                "type": "presence_batch",
                "states": presence_states
            })
            return

        if msg_type == "typing":
            recipient_id = data.get("recipient_id")
            if recipient_id and self.is_online(recipient_id):
                await self._send_to_user(recipient_id, {
                    "type": "typing",
                    "sender_id": sender_id,
                    "group_id": data.get("group_id")
                })
            return

        if msg_type == "read_receipt":
            # Relay read receipt metadata to original message sender
            target_sender_id = data.get("sender_id")
            if target_sender_id and self.is_online(target_sender_id):
                await self._send_to_user(target_sender_id, {
                    "type": "read_receipt",
                    "reader_id": sender_id,
                    "conversation_id": data.get("conversation_id"),
                    "message_ids": data.get("message_ids", [])
                })
            return

        # Check nonce for replay protection on message deliveries
        nonce = data.get("nonce")
        if nonce:
            if self.nonce_cache.is_replay_or_record(nonce):
                await self._send_to_user(sender_id, {
                    "type": "error",
                    "message": "Replay attack detected: duplicate nonce rejected"
                })
                return

        if msg_type == "group_message":
            await self._handle_group_message(sender_id, data)
            return

        # Standard 1:1 encrypted message relay
        await self._handle_direct_message(sender_id, data)

    async def _handle_direct_message(self, sender_id: str, data: dict):
        """Relay a 1:1 encrypted message."""
        recipient_id = data.get("recipient_id")
        encrypted_payload = data.get("encrypted_payload")
        nonce = data.get("nonce")
        privacy_mode = data.get("privacy_mode", "direct")
        ephemeral_key = data.get("ephemeral_key")
        signature = data.get("signature")
        ttl = data.get("ttl")
        now = time.time()
        expires_at = (now + ttl) if ttl else None

        if not recipient_id or not encrypted_payload or not nonce:
            await self._send_to_user(sender_id, {
                "type": "error",
                "message": "Missing required fields: recipient_id, encrypted_payload, nonce"
            })
            return

        # Store message in DB (for offline delivery / sync)
        msg_id = await db.store_message(
            sender_id=sender_id,
            recipient_id=recipient_id,
            encrypted_payload=encrypted_payload,
            nonce=nonce,
            privacy_mode=privacy_mode,
            ephemeral_key=ephemeral_key,
            signature=signature,
            ttl=ttl,
            expires_at=expires_at
        )

        # Build the relay envelope
        relay_envelope = {
            "type": "message",
            "id": msg_id,
            "sender_id": sender_id,
            "encrypted_payload": encrypted_payload,
            "nonce": nonce,
            "timestamp": now,
            "privacy_mode": privacy_mode,
            "ephemeral_key": ephemeral_key,
            "signature": signature,
            "ttl": ttl,
            "expires_at": expires_at
        }

        if privacy_mode == "anonymous":
            delay = random.uniform(0.5, 2.0)
            asyncio.create_task(
                self._delayed_relay(recipient_id, relay_envelope, delay, msg_id)
            )
            await self._send_to_user(sender_id, {
                "type": "message_ack",
                "id": msg_id,
                "status": "accepted_anonymous",
                "note": "Message queued for anonymous relay"
            })
        else:
            if self.is_online(recipient_id):
                await self._send_to_user(recipient_id, relay_envelope)
                await db.mark_messages_delivered([msg_id])

            await self._send_to_user(sender_id, {
                "type": "message_ack",
                "id": msg_id,
                "status": "delivered" if self.is_online(recipient_id) else "stored"
            })

    async def _handle_group_message(self, sender_id: str, data: dict):
        """Relay a group message to all group members."""
        group_id = data.get("group_id")
        encrypted_payload = data.get("encrypted_payload")
        nonce = data.get("nonce")
        privacy_mode = data.get("privacy_mode", "direct")
        signature = data.get("signature")
        ttl = data.get("ttl")
        now = time.time()
        expires_at = (now + ttl) if ttl else None

        if not group_id or not encrypted_payload or not nonce:
            return

        # Get all group members
        members = await db.get_group_members(group_id)
        member_ids = [m["user_id"] for m in members if m["user_id"] != sender_id]

        relay_envelope = {
            "type": "group_message",
            "sender_id": sender_id,
            "group_id": group_id,
            "encrypted_payload": encrypted_payload,
            "nonce": nonce,
            "timestamp": now,
            "signature": signature,
            "ttl": ttl,
            "expires_at": expires_at
        }

        for member_id in member_ids:
            msg_id = await db.store_message(
                sender_id=sender_id,
                recipient_id=member_id,
                encrypted_payload=encrypted_payload,
                nonce=nonce,
                group_id=group_id,
                privacy_mode=privacy_mode,
                signature=signature,
                ttl=ttl,
                expires_at=expires_at
            )

            if self.is_online(member_id):
                envelope = {**relay_envelope, "id": msg_id}
                if privacy_mode == "anonymous":
                    delay = random.uniform(0.5, 2.0)
                    asyncio.create_task(
                        self._delayed_relay(member_id, envelope, delay, msg_id)
                    )
                else:
                    await self._send_to_user(member_id, envelope)
                    await db.mark_messages_delivered([msg_id])

        # Ack to sender
        await self._send_to_user(sender_id, {
            "type": "message_ack",
            "group_id": group_id,
            "status": "relayed"
        })

    async def _delayed_relay(self, recipient_id: str, envelope: dict,
                             delay: float, msg_id: int):
        await asyncio.sleep(delay)
        if self.is_online(recipient_id):
            await self._send_to_user(recipient_id, envelope)
            await db.mark_messages_delivered([msg_id])

    async def _flush_pending_messages(self, user_id: str):
        """Send any messages that accumulated while the user was offline."""
        pending = await db.get_pending_messages(user_id)
        if not pending:
            return

        delivered_ids = []
        for msg in pending:
            envelope = {
                "type": "group_message" if msg.get("group_id") else "message",
                "id": msg["id"],
                "sender_id": msg["sender_id"],
                "encrypted_payload": msg["encrypted_payload"],
                "nonce": msg["nonce"],
                "timestamp": msg["timestamp"],
                "privacy_mode": msg.get("privacy_mode", "direct"),
                "ephemeral_key": msg.get("ephemeral_key"),
                "signature": msg.get("signature"),
                "ttl": msg.get("ttl"),
                "expires_at": msg.get("expires_at")
            }
            if msg.get("group_id"):
                envelope["group_id"] = msg["group_id"]

            await self._send_to_user(user_id, envelope)
            delivered_ids.append(msg["id"])

        if delivered_ids:
            await db.mark_messages_delivered(delivered_ids)

    async def _send_to_user(self, user_id: str, data: dict):
        """Send a JSON message to a connected user. Silently fail if offline."""
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                # Connection might have died
                self.active_connections.pop(user_id, None)

    async def _broadcast_presence(self, user_id: str, status: str):
        """Notify all subscribers that a user's presence changed."""
        subscribers = self.presence_subscribers.get(user_id, set())
        notification = {
            "type": "presence",
            "user_id": user_id,
            "status": status
        }
        for subscriber_id in subscribers:
            await self._send_to_user(subscriber_id, notification)


# Singleton hub instance
hub = ConnectionManager()
