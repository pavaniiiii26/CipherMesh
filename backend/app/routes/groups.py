"""
CipherMesh — Group Routes

CRUD for group metadata and membership. Group keys are encrypted per-member
on the client side — the server only stores the encrypted blobs.

PRODUCTION NOTES:
  - This implements a simple sender-keys scheme. For production, replace with
    the Messaging Layer Security (MLS) protocol for forward secrecy and
    post-compromise security.
  - Add authorization checks: only group admins should be able to add/remove members.
  - On member removal, the group key should be rotated and re-distributed
    to remaining members by the client.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app import database as db

router = APIRouter(prefix="/api/groups", tags=["groups"])


class CreateGroupRequest(BaseModel):
    name: str
    created_by: str


class AddMemberRequest(BaseModel):
    user_id: str
    encrypted_group_key: str
    nonce: str


@router.post("")
async def create_group(req: CreateGroupRequest):
    """Create a new group. The creator's client generates a group key."""
    group = await db.create_group(req.name, req.created_by)
    return group


@router.get("/{group_id}")
async def get_group(group_id: str):
    """Get group info including member list."""
    group = await db.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.post("/{group_id}/members")
async def add_member(group_id: str, req: AddMemberRequest):
    """
    Add a member to the group. The client encrypts the group key with the
    new member's public key and sends the encrypted blob here.

    PRODUCTION: Verify the requester is a group admin.
    PRODUCTION: With MLS, this would be a proper key package exchange.
    """
    group = await db.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    user = await db.get_user(req.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await db.add_group_member(group_id, req.user_id, req.encrypted_group_key, req.nonce)
    return {"status": "added", "user_id": req.user_id, "group_id": group_id}


@router.delete("/{group_id}/members/{user_id}")
async def remove_member(group_id: str, user_id: str):
    """
    Remove a member from the group.

    PRODUCTION: After removing a member, the client should rotate the group key
    and re-encrypt it for all remaining members to ensure forward secrecy.
    """
    await db.remove_group_member(group_id, user_id)
    return {"status": "removed", "user_id": user_id, "group_id": group_id}


@router.get("/user/{user_id}")
async def get_user_groups(user_id: str):
    """List all groups a user belongs to, including their encrypted group key."""
    groups = await db.get_user_groups(user_id)
    return {"groups": groups}
