"""
CipherMesh — Async SQLite Database Layer

Manages all server-side persistence. The server stores:
  - User public keys + metadata (NEVER private keys)
  - Encrypted message blobs (opaque to the server)
  - Group metadata + per-member encrypted group keys

PRODUCTION NOTES:
  - Replace SQLite with PostgreSQL or a distributed DB for scale.
  - Add TTL-based message expiration — don't persist delivered messages.
  - Add rate limiting and abuse prevention at the DB layer.
"""

import aiosqlite
import os
import time
import uuid

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ciphermesh.db")


async def get_db():
    """Get an async SQLite connection. Used as a dependency or direct call."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    """Create tables if they don't exist. Called once at app startup."""
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                public_key TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL DEFAULT 'Anonymous',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id TEXT NOT NULL,
                recipient_id TEXT,
                group_id TEXT,
                encrypted_payload TEXT NOT NULL,
                nonce TEXT NOT NULL,
                timestamp REAL NOT NULL,
                delivered INTEGER NOT NULL DEFAULT 0,
                privacy_mode TEXT NOT NULL DEFAULT 'direct',
                FOREIGN KEY (sender_id) REFERENCES users(user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_recipient
                ON messages(recipient_id, delivered);

            CREATE INDEX IF NOT EXISTS idx_messages_group
                ON messages(group_id, timestamp);

            CREATE TABLE IF NOT EXISTS groups_ (
                group_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at REAL NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(user_id)
            );

            CREATE TABLE IF NOT EXISTS group_members (
                group_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                encrypted_group_key TEXT NOT NULL,
                nonce TEXT NOT NULL,
                added_at REAL NOT NULL,
                PRIMARY KEY (group_id, user_id),
                FOREIGN KEY (group_id) REFERENCES groups_(group_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
        """)
        await db.commit()
    finally:
        await db.close()


# ─── User Operations ───────────────────────────────────────────────

async def create_user(user_id: str, public_key: str, display_name: str) -> dict:
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO users (user_id, public_key, display_name, created_at) VALUES (?, ?, ?, ?)",
            (user_id, public_key, display_name, time.time())
        )
        await db.commit()
        return {"user_id": user_id, "public_key": public_key, "display_name": display_name}
    finally:
        await db.close()


async def get_user(user_id: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT user_id, public_key, display_name, created_at FROM users WHERE user_id = ?",
            (user_id,)
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


async def get_user_by_public_key(public_key: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT user_id, public_key, display_name, created_at FROM users WHERE public_key = ?",
            (public_key,)
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


# ─── Message Operations ────────────────────────────────────────────

async def store_message(sender_id: str, recipient_id: str, encrypted_payload: str,
                        nonce: str, group_id: str = None, privacy_mode: str = "direct") -> int:
    """Store an encrypted message blob. The server CANNOT read this content."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO messages
               (sender_id, recipient_id, group_id, encrypted_payload, nonce, timestamp, delivered, privacy_mode)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
            (sender_id, recipient_id, group_id, encrypted_payload, nonce, time.time(), privacy_mode)
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def get_pending_messages(user_id: str) -> list[dict]:
    """Fetch all undelivered encrypted messages for a user (polling fallback)."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT id, sender_id, recipient_id, group_id, encrypted_payload, nonce, timestamp, privacy_mode
               FROM messages
               WHERE recipient_id = ? AND delivered = 0
               ORDER BY timestamp ASC""",
            (user_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def mark_messages_delivered(message_ids: list[int]):
    """Mark messages as delivered. In production, consider deleting them instead."""
    if not message_ids:
        return
    db = await get_db()
    try:
        placeholders = ",".join("?" for _ in message_ids)
        await db.execute(
            f"UPDATE messages SET delivered = 1 WHERE id IN ({placeholders})",
            message_ids
        )
        await db.commit()
    finally:
        await db.close()


# ─── Group Operations ──────────────────────────────────────────────

async def create_group(name: str, created_by: str) -> dict:
    group_id = str(uuid.uuid4())[:12]
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO groups_ (group_id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
            (group_id, name, created_by, time.time())
        )
        await db.commit()
        return {"group_id": group_id, "name": name, "created_by": created_by}
    finally:
        await db.close()


async def get_group(group_id: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT group_id, name, created_by, created_at FROM groups_ WHERE group_id = ?",
            (group_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None

        members_cursor = await db.execute(
            """SELECT gm.user_id, u.display_name, u.public_key
               FROM group_members gm
               JOIN users u ON gm.user_id = u.user_id
               WHERE gm.group_id = ?""",
            (group_id,)
        )
        members = await members_cursor.fetchall()

        group = dict(row)
        group["members"] = [dict(m) for m in members]
        return group
    finally:
        await db.close()


async def add_group_member(group_id: str, user_id: str,
                           encrypted_group_key: str, nonce: str):
    db = await get_db()
    try:
        await db.execute(
            """INSERT OR REPLACE INTO group_members
               (group_id, user_id, encrypted_group_key, nonce, added_at)
               VALUES (?, ?, ?, ?, ?)""",
            (group_id, user_id, encrypted_group_key, nonce, time.time())
        )
        await db.commit()
    finally:
        await db.close()


async def remove_group_member(group_id: str, user_id: str):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
            (group_id, user_id)
        )
        await db.commit()
    finally:
        await db.close()


async def get_user_groups(user_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT g.group_id, g.name, g.created_by, g.created_at,
                      gm.encrypted_group_key, gm.nonce
               FROM groups_ g
               JOIN group_members gm ON g.group_id = gm.group_id
               WHERE gm.user_id = ?
               ORDER BY g.created_at DESC""",
            (user_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_group_members(group_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT gm.user_id, u.public_key, u.display_name,
                      gm.encrypted_group_key, gm.nonce
               FROM group_members gm
               JOIN users u ON gm.user_id = u.user_id
               WHERE gm.group_id = ?""",
            (group_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()
