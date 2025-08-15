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

def ensure_room(room_id: str, deck_a: str = None, deck_b: str = None) -> RoomCtx:
    if room_id in rooms:
        return rooms[room_id]
    # try load from disk or create new with default decks
    loaded = load_room(room_id)
    if loaded is None:
        # Use provided decks or fallback to first available deck
        from .persistence import DECKS_DIR
        available_decks = [f.stem for f in DECKS_DIR.glob("*.json")]
        if not available_decks:
            # Create minimal fallback if no decks exist
            p1 = [{"name": f"Card {i+1}"} for i in range(40)]
            p2 = [{"name": f"Card {i+1}"} for i in range(40)]
        else:
            default_deck = available_decks[0]
            deck_a = deck_a or default_deck
            deck_b = deck_b or default_deck
            p1 = load_deck(f"{deck_a}.json")
            p2 = load_deck(f"{deck_b}.json")
        state = new_room(room_id, p1, p2)
    else:
        state = loaded
    # Sanitize any card.image values that accidentally persisted absolute paths
    changed = False
    for c in state.cards.values():
        if not c.image:
            continue
        img = c.image.replace("\\", "/")
        # Case 1: image stored like "/images/C:/.../images/<file>.jpg" -> keep only final filename
        if img.startswith("/images/"):
            rest = img[len("/images/"):]
            if ":" in rest:  # drive letter present, strip path
                filename = rest.split("/")[-1]
                new_val = f"/images/{filename}"
                if new_val != c.image:
                    c.image = new_val
                    changed = True
        # Case 2: absolute filesystem path without leading /images
        elif ":/" in img.lower():
            filename = img.split("/")[-1]
            new_val = f"/images/{filename}"
            if new_val != c.image:
                c.image = new_val
                changed = True
    if changed:
        save_room(state)  # persist migration so future loads are clean
    ctx = RoomCtx(state)
    rooms[room_id] = ctx
    return ctx

@app.post("/api/join_room")
async def join_room(request: Request):
    """Join or create a room with specific deck selection"""
    data = await request.json()
    room_id = data.get("room_id")
    player_id = data.get("player_id")
    deck_name = data.get("deck")
    
    if not room_id or not player_id or not deck_name:
        return {"error": "Missing required fields"}
    
    # Get or create room with deck preferences
    if room_id in rooms:
        ctx = rooms[room_id]
        # Room already exists, can't change decks
        return {"success": True, "message": "Joined existing room"}
    else:
        # Create new room - we'll set the deck for this player
        # For now, use the same deck for both players (can be enhanced later)
        ctx = ensure_room(room_id, deck_name, deck_name)
        return {"success": True, "message": "Created new room"}

@app.get("/api/decks")
async def list_decks():
    """List all available deck files"""
    from .persistence import DECKS_DIR
    deck_files = [f.stem for f in DECKS_DIR.glob("*.json")]
    return {"decks": sorted(deck_files)}

@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str):
    return ensure_room(room_id).state

@app.get("/api/debug/images/{room_id}")
async def debug_images(room_id: str):
    ctx = ensure_room(room_id)
    imgs = sorted({c.image for c in ctx.state.cards.values() if c.image})
    return {"count": len(imgs), "samples": imgs[:20]}

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
