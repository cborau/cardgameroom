import asyncio, json
from pathlib import Path
from typing import Dict, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from .models import ClientHello, ClientAction, ServerState
from .state import new_room, apply_action
from .persistence import save_room, load_room, load_deck

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

CLIENT_DIR = Path(__file__).parents[1] / "client"
app.mount("/static", StaticFiles(directory=str(CLIENT_DIR)), name="static")

IMAGES_DIR = Path(__file__).parent / "data" / "images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")

@app.get("/")
async def root():
    return FileResponse(CLIENT_DIR / "index.html")

# in-memory room registry: room_id -> dict
class RoomCtx:
    def __init__(self, state):
        self.state = state
        self.connections: Set[WebSocket] = set()
        self.lock = asyncio.Lock()

rooms: Dict[str, RoomCtx] = {}

def ensure_room(room_id: str) -> RoomCtx:
    if room_id in rooms:
        return rooms[room_id]
    # try load from disk or create new with sample decks
    loaded = load_room(room_id)
    if loaded is None:
        p1 = load_deck("sample_p1.json")
        p2 = load_deck("sample_p2.json")
        state = new_room(room_id, p1, p2)
    else:
        state = loaded
    ctx = RoomCtx(state)
    rooms[room_id] = ctx
    return ctx

@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str):
    return ensure_room(room_id).state

@app.post("/api/save/{room_id}")
async def save(room_id: str):
    ctx = ensure_room(room_id)
    save_room(ctx.state)
    return {"ok": True}

@app.post("/api/load/{room_id}")
async def load(room_id: str):
    loaded = load_room(room_id)
    if loaded is None:
        return {"ok": False, "msg": "No saved state"}
    rooms[room_id] = RoomCtx(loaded)
    return {"ok": True}

@app.websocket("/ws/{room_id}")
async def ws_endpoint(ws: WebSocket, room_id: str):
    await ws.accept()
    ctx = ensure_room(room_id)
    ctx.connections.add(ws)
    try:
        # initial state push
        await ws.send_json(ServerState(kind="state", state=ctx.state).model_dump())
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg.get("kind") == "hello":
                # optional name sync
                hello = ClientHello.model_validate(msg)
                if hello.name:
                    async with ctx.lock:
                        ctx.state.players[hello.player_id].name = hello.name[:24]
                        await broadcast(ctx)
                continue

            if msg.get("kind") == "action":
                act = ClientAction.model_validate(msg)
                async with ctx.lock:
                    ctx.state = apply_action(ctx.state, act.type, act.payload)
                    await broadcast(ctx)

    except WebSocketDisconnect:
        pass
    finally:
        ctx.connections.discard(ws)

async def broadcast(ctx: RoomCtx):
    payload = ServerState(kind="state", state=ctx.state).model_dump()
    dead = []
    for c in ctx.connections:
        try:
            await c.send_json(payload)
        except Exception:
            dead.append(c)
    for d in dead:
        ctx.connections.discard(d)
