"""
CipherMesh — FastAPI Application Entry Point

Sets up CORS, mounts all REST routers, and exposes the WebSocket endpoint.
The server acts purely as an encrypted message relay — it never sees plaintext.

PRODUCTION NOTES:
  - Restrict CORS origins to the actual frontend domain.
  - Add HTTPS/TLS termination (via reverse proxy like nginx).
  - Add request signing / authentication middleware.
  - Add structured logging and monitoring.
"""

import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.websocket_hub import hub
from app.routes import users, contacts, groups, messages


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    await init_db()
    print("✓ CipherMesh database initialized")
    print("✓ WebSocket relay hub ready")
    yield
    print("⊘ CipherMesh shutting down")


app = FastAPI(
    title="CipherMesh Relay",
    description="Privacy-focused encrypted message relay. The server never sees plaintext.",
    version="0.1.0-prototype",
    lifespan=lifespan
)

# CORS — allow the Vite dev server
# PRODUCTION: Restrict to actual frontend domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST routers
app.include_router(users.router)
app.include_router(contacts.router)
app.include_router(groups.router)
app.include_router(messages.router)


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for real-time encrypted message relay.

    The user_id is passed as a path parameter. In production, this should
    be authenticated via a challenge-response protocol proving the client
    holds the private key for this user_id.

    PRODUCTION: Replace path-param auth with signed token / challenge-response.
    """
    await hub.connect(websocket, user_id)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                await hub.handle_message(user_id, data)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON"
                })
    except WebSocketDisconnect:
        await hub.disconnect(user_id)
    except Exception:
        await hub.disconnect(user_id)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "CipherMesh Relay",
        "online_users": len(hub.get_online_users())
    }
