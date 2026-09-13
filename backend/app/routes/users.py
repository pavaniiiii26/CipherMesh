"""
CipherMesh — User Routes

Handles user registration and public key lookup.
The server stores ONLY public keys — private keys never leave the client.

PRODUCTION NOTES:
  - Add challenge-response authentication: the client proves it holds the
    private key corresponding to the public key it registers.
  - Add rate limiting on registration to prevent Sybil attacks.
  - user_id derivation should be verified server-side (hash the public key
    and confirm it matches the claimed user_id).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app import database as db
from app.websocket_hub import hub

router = APIRouter(prefix="/api/users", tags=["users"])


class RegisterRequest(BaseModel):
    user_id: str
    public_key: str
    display_name: str = "Anonymous"


class RegisterResponse(BaseModel):
    user_id: str
    public_key: str
    display_name: str


@router.post("/register", response_model=RegisterResponse)
async def register_user(req: RegisterRequest):
    """
    Register a new user by storing their public key.

    The client generates a keypair locally and sends only the public key here.
    The user_id is derived from the public key fingerprint on the client side.

    PRODUCTION: Verify that user_id == hash(public_key) server-side.
    """
    # Check if user already exists
    existing = await db.get_user(req.user_id)
    if existing:
        # Idempotent — return existing user
        return RegisterResponse(**existing)

    # Check if public key is already registered under a different ID
    existing_by_key = await db.get_user_by_public_key(req.public_key)
    if existing_by_key:
        return RegisterResponse(**existing_by_key)

    user = await db.create_user(req.user_id, req.public_key, req.display_name)
    return RegisterResponse(**user)


@router.get("/{user_id}")
async def get_user(user_id: str):
    """Fetch a user's public key and metadata."""
    user = await db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{user_id}/presence")
async def get_presence(user_id: str):
    """Check if a user is currently connected."""
    user = await db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id": user_id,
        "status": "online" if hub.is_online(user_id) else "offline"
    }
