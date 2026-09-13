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


class ConnectionManager:
    """Manages active WebSocket connections and message relay."""

    def __init__(self):
        # user_id -> WebSocket
        self.active_connections: dict[str, WebSocket] = {}
        # user_id -> set of user_ids who want presence updates
        self.presence_subscribers: dict[str, set[str]] = {}

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

        Expected envelope format:
        {
            "type": "message" | "presence_subscribe" | "typing" | "group_message",
            "recipient_id": "...",       # for 1:1 messages
            "group_id": "...",           # for group messages
            "encrypted_payload": "...",  # base64-encoded encrypted blob
            "nonce": "...",              # base64-encoded nonce
            "privacy_mode": "direct" | "relay" | "anonymous"
        }

        The server does NOT decrypt encrypted_payload. It's an opaque blob.
        """
        msg_type = data.get("type", "message")

        if msg_type == "presence_subscribe":
            # Client wants presence updates for a list of user_ids
            contact_ids = data.get("contact_ids", [])
            for cid in contact_ids:
                if cid not in self.presence_subscribers:
                    self.presence_subscribers[cid] = set()
                self.presence_subscribers[cid].add(sender_id)

            # Send back current presence state for requested contacts
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
            # Relay typing indicator (not encrypted, just metadata)
            recipient_id = data.get("recipient_id")
            if recipient_id and self.is_online(recipient_id):
                await self._send_to_user(recipient_id, {
                    "type": "typing",
                    "sender_id": sender_id,
                    "group_id": data.get("group_id")
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

        if not recipient_id or not encrypted_payload or not nonce:
            await self._send_to_user(sender_id, {
                "type": "error",
                "message": "Missing required fields: recipient_id, encrypted_payload, nonce"
            })
            return

        # Store message in DB (always, for offline delivery)
        msg_id = await db.store_message(
            sender_id=sender_id,
            recipient_id=recipient_id,
            encrypted_payload=encrypted_payload,
            nonce=nonce,
            privacy_mode=privacy_mode
        )

        # Build the relay envelope
        relay_envelope = {
            "type": "message",
            "id": msg_id,
            "sender_id": sender_id,
            "encrypted_payload": encrypted_payload,
            "nonce": nonce,
            "timestamp": time.time(),
            "privacy_mode": privacy_mode
        }

        if privacy_mode == "anonymous":
            # PLACEHOLDER: Simulate onion-style routing with a random delay.
            # In production, this would route through Tor or a mixnet.
            # The delay adds a small amount of timing obfuscation.
            delay = random.uniform(0.5, 2.0)
            asyncio.create_task(
                self._delayed_relay(recipient_id, relay_envelope, delay, msg_id)
            )
            # Confirm to sender that message was accepted for anonymous relay
            await self._send_to_user(sender_id, {
                "type": "message_ack",
                "id": msg_id,
                "status": "accepted_anonymous",
                "note": "Message queued for anonymous relay"
            })
        else:
            # Direct or relay mode — send immediately if online
            if self.is_online(recipient_id):
                await self._send_to_user(recipient_id, relay_envelope)
                await db.mark_messages_delivered([msg_id])

            # Confirm delivery to sender
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
            "timestamp": time.time()
        }

        for member_id in member_ids:
            # Store for each recipient (for offline delivery)
            msg_id = await db.store_message(
                sender_id=sender_id,
                recipient_id=member_id,
                encrypted_payload=encrypted_payload,
                nonce=nonce,
                group_id=group_id,
                privacy_mode=privacy_mode
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
        """
        PLACEHOLDER for anonymous routing.
        Adds a random delay to simulate onion-style timing obfuscation.

        PRODUCTION: Replace with actual Tor circuit / mixnet packet routing.
        The message should be wrapped in multiple encryption layers and
        routed through independent relay nodes.
        """
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
                "privacy_mode": msg.get("privacy_mode", "direct")
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
