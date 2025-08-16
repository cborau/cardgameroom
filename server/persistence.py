import json
from pathlib import Path
from .models import RoomState

DATA_DIR = Path(__file__).parent / "data"
ROOMS_DIR = DATA_DIR / "rooms"
DECKS_DIR = DATA_DIR / "decks"
ROOMS_DIR.mkdir(parents=True, exist_ok=True)
DECKS_DIR.mkdir(parents=True, exist_ok=True)

def _norm_image(path: str | None) -> str | None:
    if not path:
        return None
    # Handle both single and double backslashes from JSON
    p = path.replace("\\\\", "/").replace("\\", "/")
    # Strip any embedded absolute path segments preceding an images directory
    # Examples:
    #   C:/..../images/uuid-0.jpg -> images/uuid-0.jpg
    #   /images/C:/.../images/uuid-0.jpg -> images/uuid-0.jpg
    lower = p.lower()
    if "images/" in lower:
        # Take only the last occurrence to get filename
        parts = p.split("/")
        for i in range(len(parts)-1, -1, -1):
            if parts[i].lower().startswith("images"):
                # if exact 'images' segment, take following filename part (if any)
                if parts[i].lower() == "images" and i+1 < len(parts):
                    p = f"/images/{parts[i+1]}"
                else:
                    # segment already includes filename after images/
                    if parts[i].lower().startswith("images"):
                        # rebuild from this segment ensuring leading slash
                        seg = "/".join(parts[i:])
                        if not seg.startswith("/"):
                            seg = "/" + seg
                        p = seg
                break
    if p.startswith("http://") or p.startswith("https://"):
        return p
    if p.startswith("/images/"):
        return p
    if p.startswith("images/"):
        return "/" + p
    # fallback: treat as bare filename
    return f"/images/{p.split('/')[-1]}"

def save_room(state: RoomState):
    f = ROOMS_DIR / f"{state.room_id}.json"
    f.write_text(state.model_dump_json(indent=2), encoding="utf-8")

def load_room(room_id: str) -> RoomState | None:
    f = ROOMS_DIR / f"{room_id}.json"
    if not f.exists():
        return None
    data = json.loads(f.read_text(encoding="utf-8"))
    return RoomState.model_validate(data)

def load_deck(name: str) -> list[dict]:
    """Supports:
       A) legacy: ["Card A", ...]
       B) rich: {"cards": [{"name":"...", "qty":3, "image":"images/..jpg", ...}]}
    """
    deck_file = name if name.lower().endswith(".json") else f"{name}.json"
    p = DECKS_DIR / deck_file
    if not p.exists():
        # fallback: 40 generic cards
        return [{"name": f"Card {i+1}"} for i in range(40)]
    data = json.loads(p.read_text(encoding="utf-8"))

    # legacy list
    if isinstance(data, list):
        return [{"name": n} if isinstance(n, str) else n for n in data]

    cards = []
    for c in data.get("cards", []):
        qty = int(c.get("qty", 1))
        img = _norm_image(c.get("image"))
        base = {
            "name": c["name"],
            "image": img,
            "scryfall_id": c.get("scryfall_id"),
            "set": c.get("set"),
            "collector_number": c.get("collector_number"),
        }
        cards.extend([base.copy() for _ in range(qty)])
    return cards

