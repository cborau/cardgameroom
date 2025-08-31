import json, os, re, time, hashlib
from pathlib import Path
from urllib.parse import quote_plus
import requests
from tqdm import tqdm

# 1) List your deck URLs here (Archidekt, Moxfield, Deckstats, Goldfish, etc.). WARNING: it includes sideboard cards.
DECK_URLS = [
    #"https://www.mtggoldfish.com/deck/7287036#paper",
    # "https://www.mtggoldfish.com/deck/7248284#paper"
]
# You can export a deck from Goldfish in Arena format (and manually remove sideboard cards).
DECK_TXTS = [
    # "Modern-Amulet Titan.txt",
    # "Modern-Dimir Murktide.txt",
    # "Modern-Domain Zoo.txt",
    "Modern-Jund Aggro.txt",
    #"Affinity.txt"
]

# 2) Output folders
# Base = folder where this script lives
BASE_DIR = Path(__file__).resolve().parent
# Data root (server/data)
DATA_DIR = (BASE_DIR / "server" / "data").resolve()
# Output folders
OUT_DIR = DATA_DIR / "decks"
IMG_DIR = DATA_DIR / "images"
# Ensure they exist (create parents if missing)
OUT_DIR.mkdir(parents=True, exist_ok=True)
IMG_DIR.mkdir(parents=True, exist_ok=True)

# 3) Scryfall helpers
SCRYFALL_SEARCH = "https://api.scryfall.com/cards/search?q="  # fulltext search
# Prefer 'png' or 'large' image; 'normal' is smaller. Use 'png' if you want transparent crops on DFCs.
PREFERRED_IMAGE_KEYS = ["normal","large","png"]

# polite rate limit to avoid hammering Scryfall
LAST_REQ = 0.0
MIN_GAP = 0.2  # ~1/MIN_GAP req/s max; 

def polite_get(url, **kw):
    global LAST_REQ
    wait = MIN_GAP - (time.time() - LAST_REQ)
    if wait > 0:
        time.sleep(wait)
    r = requests.get(url, timeout=20, **kw)
    LAST_REQ = time.time()
    r.raise_for_status()
    return r

def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

def scryfall_find_card(name: str):
    exact_url = f"https://api.scryfall.com/cards/named?exact={quote_plus(name)}"
    r = polite_get(exact_url)
    if r.status_code == 200:
        return r.json()
    # fallback to fuzzy
    fuzzy_url = f"https://api.scryfall.com/cards/named?fuzzy={quote_plus(name)}"
    return polite_get(fuzzy_url).json()

def pick_image_uri(card_json: dict) -> str | None:
    # Single-faced
    if "image_uris" in card_json:
        iu = card_json["image_uris"]
        for key in PREFERRED_IMAGE_KEYS:
            if key in iu:
                return iu[key]
    # Double-faced or modal
    if "card_faces" in card_json and card_json["card_faces"]:
        iu = card_json["card_faces"][0].get("image_uris", {})
        for key in PREFERRED_IMAGE_KEYS:
            if key in iu:
                return iu[key]
    return None

def pick_image_info(card_json: dict):
    # returns dict with url, face index, extension
    def ext_from(url): return ".png" if url.lower().endswith(".png") else ".jpg"

    if "image_uris" in card_json:
        iu = card_json["image_uris"]
        for k in PREFERRED_IMAGE_KEYS:
            if k in iu:
                return {"url": iu[k], "face": 0, "ext": ext_from(iu[k])}

    faces = card_json.get("card_faces") or []
    if faces:
        iu = faces[0].get("image_uris", {})
        for k in PREFERRED_IMAGE_KEYS:
            if k in iu:
                return {"url": iu[k], "face": 0, "ext": ext_from(iu[k])}
    return None

def download_image(card_json: dict, info: dict) -> str:
    # filename based on Scryfall id + face -> stable across decks
    fname = f"{card_json['id']}-{info['face']}{info['ext']}"
    fpath = IMG_DIR / fname
    if not fpath.exists():
        img = polite_get(info["url"]).content
        with open(fpath, "wb") as f:
            f.write(img)
    return str(fpath)

def parse_deck_any(url_or_text: str):
    import mtg_parser as mp
    cards_iter = mp.parse_deck(url_or_text)  # generator of Card objects
    counts = {}
    for c in cards_iter:
        # Primary path: Card object from mtg_parser
        if hasattr(c, "name"):
            name = c.name.strip()
            qty = int(getattr(c, "quantity", 1))
        else:
            # Fallback in case some source yields dict-like records
            name = str(c.get("name", "")).strip()
            qty = int(c.get("qty", c.get("quantity", 1)) or 1)

        if not name:
            continue
        counts[name] = counts.get(name, 0) + qty

    return [{"name": n, "qty": q} for n, q in sorted(counts.items())]


def fetch_and_save_deck(url: str, deck_name: str = None):

    print(f"\nProcessing deck: {url}")
    cards = parse_deck_any(url)
    print(f"  Found {sum(c['qty'] for c in cards)} cards, {len(cards)} unique names")

    # Resolve images once per unique name
    resolved = []
    for c in tqdm(cards, desc="Resolving images"):
        card_json = scryfall_find_card(c["name"])
        info = pick_image_info(card_json)
        local_img = download_image(card_json, info) if info else None
        resolved.append({
            "name": c["name"],
            "qty": c["qty"],
            "image": local_img,
            "scryfall_id": card_json.get("id"),
            "set": card_json.get("set"),
            "collector_number": card_json.get("collector_number")
        })

    # Save deck JSON alongside a manifest of images
    if not deck_name:
        deck_name = slugify(url.split("/")[-1] or "deck")
    out_path = OUT_DIR / f"{deck_name}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"source": url, "cards": resolved}, f, ensure_ascii=False, indent=2)
    print(f"  Saved deck JSON -> {out_path}")
    return out_path

def main():
    if not DECK_URLS and not DECK_TXTS:
        print("No deck URLs or text files provided. Please add some to DECK_URLS or DECK_TXTS.")
        return
    
    for url in DECK_URLS:
        try:
            fetch_and_save_deck(url)
        except Exception as e:
            print(f"URLS - Error with {url}: {e}")
    for txt_file in DECK_TXTS:
        try:
            filename = Path.joinpath(OUT_DIR,txt_file)
            fetch_and_save_deck(filename.read_text(encoding="utf-8"),filename.stem)
        except Exception as e:
            print(f"TXTS - Error with {txt_file}: {e}")

if __name__ == "__main__":
    main()
