# server/app.py
import json
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .models import ClientHello, ClientAction, ServerState
from .state import new_room, apply_action
from .persistence import save_room, load_room, load_deck

app = FastAPI(title="CardGameRoom")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parent.parent  # project root (one level above /server)

def _find_client_dir() -> Path:
    for c in [ROOT / "client", ROOT / "public", ROOT / "static", ROOT]:
        if (c / "index.html").exists():
            return c
    return ROOT

CLIENT = _find_client_dir()
app.mount("/static", StaticFiles(directory=CLIENT), name="static")

# Serve card images saved under server/data/images as /images/...
IMG_DIR = ROOT / "server" / "data" / "images"
if IMG_DIR.exists():
    app.mount("/images", StaticFiles(directory=IMG_DIR), name="images")

rooms: Dict[str, Dict[str, object]] = {}

def _model_dump(m):
    return m.model_dump() if hasattr(m, "model_dump") else m.dict()

async def _broadcast(room_id: str):
    if room_id not in rooms:
        return
    payload = _model_dump(ServerState(kind="state", state=rooms[room_id]["state"]))
    for peer in list(rooms[room_id]["peers"]):
        try:
            await peer.send_json(payload)
        except Exception:
            try:
                rooms[room_id]["peers"].discard(peer)  # type: ignore[arg-type]
            except Exception:
                pass

@app.get("/")
async def index():
    return FileResponse(str(CLIENT / "index.html"))

@app.get("/api/decks")
async def list_decks():
    decks_dir = ROOT / "server" / "data" / "decks"
    decks = [p.stem for p in decks_dir.glob("*.json")] if decks_dir.exists() else []
    return {"decks": decks}

@app.post("/api/save/{room_id}")
async def http_save(room_id: str):
    ctx = rooms.get(room_id)
    if not ctx:
        return {"ok": False, "msg": "Room not found"}
    save_room(ctx["state"])  # type: ignore[arg-type]
    return {"ok": True}

@app.post("/api/load/{room_id}")
async def http_load(room_id: str):
    st = load_room(room_id)
    if not st:
        return {"ok": False, "msg": "No saved state"}
    rooms[room_id] = {"state": st, "peers": set()}
    await _broadcast(room_id)
    return {"ok": True}

@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str):
    await ws.accept()
    try:
        hello = ClientHello(**json.loads(await ws.receive_text()))

        ctx = rooms.get(room_id)
        if ctx is None:
            # Pick decks. If the first joiner sent a deck, use it for that seat.
            deckA_name = hello.deck if hello.player_id == "A" and hello.deck else "A"
            deckB_name = hello.deck if hello.player_id == "B" and hello.deck else "B"
            st = new_room(room_id, load_deck(deckA_name), load_deck(deckB_name))
            if hello.name:
                st.players[hello.player_id].name = hello.name
            ctx = rooms[room_id] = {"state": st, "peers": set()}
        else:
            # If player provided a deck and their library is empty, load it now.
            if hello.deck:
                st = ctx["state"]  # type: ignore[assignment]
                if not st.players[hello.player_id].library:
                    deck = load_deck(hello.deck)
                    st.players[hello.player_id].library = []
                    # append new cards into room state
                    for d in deck:
                        from .state import _mk_card  # local helper
                        c = _mk_card(d)
                        st.cards[c.id] = c
                        st.players[hello.player_id].library.append(c.id)

            if hello.name:
                try:
                    ctx["state"].players[hello.player_id].name = hello.name  # type: ignore[index]
                except Exception:
                    pass

        ctx["peers"].add(ws)  # type: ignore[index]
        await ws.send_json(_model_dump(ServerState(kind="state", state=ctx["state"])))  # type: ignore[index]

        while True:
            raw = await ws.receive_text()
            act = ClientAction(**json.loads(raw))
            apply_action(ctx["state"], act.type, act.payload)  # type: ignore[index]
            await _broadcast(room_id)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        try:
            rooms.get(room_id, {}).get("peers", set()).discard(ws)  # type: ignore[union-attr]
        except Exception:
            pass
