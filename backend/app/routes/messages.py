"""
CipherMesh — Message Routes (Polling Fallback)

REST endpoints for fetching pending messages when WebSocket is unavailable.
All messages are encrypted blobs — the server cannot read them.

PRODUCTION NOTES:
  - These endpoints are a fallback for when WebSockets aren't available.
  - Add authentication (signed request with user's private key).
  - Add pagination for large backlogs.
  - Consider message TTL and auto-expiration.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from app import database as db

router = APIRouter(prefix="/api/messages", tags=["messages"])


class AckRequest(BaseModel):
    message_ids: list[int]


@router.get("/{user_id}/pending")
async def get_pending_messages(user_id: str):
    """
    Fetch all undelivered encrypted messages for a user.
    Used as a polling fallback when WebSocket is disconnected.

    Returns opaque encrypted blobs — the server has no idea what's inside.
    """
    messages = await db.get_pending_messages(user_id)
    return {"messages": messages}


@router.post("/{user_id}/ack")
async def acknowledge_messages(user_id: str, req: AckRequest):
    """
    Mark messages as delivered so they won't be returned again.

    PRODUCTION: Consider deleting messages after acknowledgment rather
    than just marking them, to minimize data retention.
    """
    await db.mark_messages_delivered(req.message_ids)
    return {"status": "acknowledged", "count": len(req.message_ids)}
