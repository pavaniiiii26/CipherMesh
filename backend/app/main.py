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

import asyncio
import json
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, cleanup_expired_messages
from app.websocket_hub import hub
from app.routes import users, contacts, groups, messages


class HttpRateLimiter:
    """Sliding-window HTTP rate limiter per IP address."""
    def __init__(self, max_requests_per_minute: int = 120):
        self.max_requests = max_requests_per_minute
        self.clients = defaultdict(list)

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        # Filter timestamps older than 60 seconds
        self.clients[client_ip] = [t for t in self.clients[client_ip] if now - t < 60.0]
        if len(self.clients[client_ip]) >= self.max_requests:
            return False
        self.clients[client_ip].append(now)
        return True


http_rate_limiter = HttpRateLimiter(max_requests_per_minute=120)


async def expired_messages_worker():
    """Background task that sweeps and deletes expired disappearing messages."""
    while True:
        try:
            await asyncio.sleep(30)
            purged = await cleanup_expired_messages()
            if purged > 0:
                print(f"[Relay TTL] Cleaned up {purged} expired messages")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Relay TTL Error] {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup and launch background cleanup worker."""
    await init_db()
    print("[OK] CipherMesh database initialized")
    print("[OK] WebSocket relay hub ready")
    worker = asyncio.create_task(expired_messages_worker())
    yield
    worker.cancel()
    print("[--] CipherMesh shutting down")


app = FastAPI(
    title="CipherMesh Relay",
    description="Privacy-focused encrypted message relay. The server never sees plaintext.",
    version="0.2.0-secure",
    lifespan=lifespan
)

# HTTP Rate Limiting Middleware
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    # Only rate limit API requests, skip health checks
    if request.url.path.startswith("/api") and request.url.path != "/api/health":
        client_ip = request.client.host if request.client else "unknown"
        if not http_rate_limiter.is_allowed(client_ip):
            return Response(
                content=json.dumps({"detail": "Rate limit exceeded (too many requests). Please wait."}),
                status_code=429,
                media_type="application/json"
            )
    return await call_next(request)

# CORS — allow the Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
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
