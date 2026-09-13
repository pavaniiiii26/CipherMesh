"""
CipherMesh — Contact Routes

Provides an endpoint to resolve a user_id into their public key + metadata,
used during QR-based contact exchange.

PRODUCTION NOTES:
  - Contacts are stored CLIENT-SIDE only (localStorage/IndexedDB).
  - The server simply provides a lookup service for public keys.
  - In production, consider adding contact verification (e.g., safety numbers
    like Signal) to prevent MITM attacks on the key exchange.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app import database as db

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


class ResolveRequest(BaseModel):
    user_id: str


@router.post("/resolve")
async def resolve_contact(req: ResolveRequest):
    """
    Given a user_id (from a QR code scan), return the user's public key
    and display name so the client can add them as a contact.

    PRODUCTION: Consider adding a verification step — the resolver should
    confirm out-of-band that the public key matches expectations (e.g.,
    comparing safety numbers in person).
    """
    user = await db.get_user(req.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id": user["user_id"],
        "public_key": user["public_key"],
        "display_name": user["display_name"]
    }
