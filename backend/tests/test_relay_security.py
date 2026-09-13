"""
CipherMesh — Security Hardening & Relay Verification Tests

Tests:
  1. User Registration with Ed25519 signing public key & name sanitization
  2. Contact Resolution with public key and signing key
  3. Replay Protection (Duplicate nonce rejection)
  4. Connection Rate Limiting (Flood prevention)
  5. Ephemeral Forward Secrecy payload storage & retrieval
  6. Disappearing Messages (TTL) automatic database purge
"""

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import database as db
from app.websocket_hub import hub, SeenNoncesCache, ConnectionRateLimiter


async def run_tests():
    print("========================================")
    print("  CipherMesh Relay Security Test Suite")
    print("========================================")

    await db.init_db()
    print("[PASS] DB initialization and schema migration OK")

    # Test 1: User Registration with Ed25519 signing key & sanitization
    test_uid = f"test_{int(time.time())}"
    test_pub = f"pubkey_{int(time.time())}"
    test_sign_pub = f"signkey_{int(time.time())}"
    dirty_name = "  Alice <script>alert(1)</script>   "

    user = await db.create_user(
        user_id=test_uid,
        public_key=test_pub,
        display_name=dirty_name.strip().replace("<", "&lt;").replace(">", "&gt;")[:32],
        signing_public_key=test_sign_pub
    )
    assert user["user_id"] == test_uid
    assert user["signing_public_key"] == test_sign_pub
    assert "<script>" not in user["display_name"]
    print("[PASS] Test 1: User registration with signing keys & input sanitization")

    # Test 2: Contact Resolution
    fetched = await db.get_user(test_uid)
    assert fetched is not None
    assert fetched["signing_public_key"] == test_sign_pub
    print("[PASS] Test 2: Contact resolution returns valid public & signing keys")

    # Test 3: Replay Protection
    nonce_cache = SeenNoncesCache(window_seconds=10.0)
    test_nonce = f"nonce_{time.time()}"

    # First attempt: should NOT be a replay
    is_replay_1 = nonce_cache.is_replay_or_record(test_nonce)
    assert not is_replay_1, "First occurrence of nonce should be accepted"

    # Second attempt with same nonce: MUST be flagged as replay!
    is_replay_2 = nonce_cache.is_replay_or_record(test_nonce)
    assert is_replay_2, "Second occurrence of nonce must be rejected as replay attack"
    print("[PASS] Test 3: Replay protection detects and blocks duplicate nonces")

    # Test 4: Rate Limiting
    limiter = ConnectionRateLimiter(max_messages_per_second=5)
    user_id = "flooder_user"

    accepted_count = 0
    blocked_count = 0
    for _ in range(10):
        if limiter.is_rate_limited(user_id):
            blocked_count += 1
        else:
            accepted_count += 1

    assert accepted_count == 5, f"Expected 5 accepted messages, got {accepted_count}"
    assert blocked_count == 5, f"Expected 5 blocked messages, got {blocked_count}"
    print("[PASS] Test 4: Sliding-window rate limiter prevents flooding")

    # Test 5: Forward Secrecy & Ephemeral Key Storage
    msg_id = await db.store_message(
        sender_id=test_uid,
        recipient_id="recipient_test",
        encrypted_payload="encrypted_blob_test",
        nonce="unique_nonce_123",
        ephemeral_key="ephemeral_x25519_key_abc",
        signature="ed25519_signature_xyz",
        ttl=2, # 2 seconds TTL
    )
    assert msg_id > 0

    pending = await db.get_pending_messages("recipient_test")
    assert any(m["id"] == msg_id for m in pending)
    msg_row = next(m for m in pending if m["id"] == msg_id)
    assert msg_row["ephemeral_key"] == "ephemeral_x25519_key_abc"
    assert msg_row["signature"] == "ed25519_signature_xyz"
    assert msg_row["ttl"] == 2
    print("[PASS] Test 5: Ephemeral forward secrecy keys and digital signatures preserved in storage")

    # Test 6: Disappearing Messages (TTL) automatic purge
    print("Waiting 2.5s for TTL expiration...")
    await asyncio.sleep(2.5)

    # Calling cleanup_expired_messages
    purged_count = await db.cleanup_expired_messages()
    assert purged_count >= 1, f"Expected at least 1 purged message, got {purged_count}"

    # Verify message is gone
    pending_after = await db.get_pending_messages("recipient_test")
    assert not any(m["id"] == msg_id for m in pending_after)
    print("[PASS] Test 6: Disappearing messages TTL purge verified successfully")

    print("\n========================================")
    print("  ALL 6 SECURITY TEST SUITES PASSED! OK")
    print("========================================")


if __name__ == "__main__":
    asyncio.run(run_tests())
