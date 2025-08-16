import random, uuid
from typing import Dict, List
from .models import RoomState, PlayerState, CardInstance

def _uid() -> str:
    return uuid.uuid4().hex[:12]

def _mk_card(desc) -> CardInstance:
    if isinstance(desc, str):
        return CardInstance(id=_uid(), name=desc)
    return CardInstance(
        id=_uid(),
        name=desc.get("name","Card"),
        image=desc.get("image"),
        scryfall_id=desc.get("scryfall_id"),
        set=desc.get("set"),
        collector_number=desc.get("collector_number"),
    )

def new_room(room_id: str, deckA: List[dict] | None = None, deckB: List[dict] | None = None) -> RoomState:
    pA = PlayerState(id="A")
    pB = PlayerState(id="B")
    cards: Dict[str, CardInstance] = {}

    def load_into(deck: List[dict] | None):
        nonlocal cards
        if not deck:
            return []
        ids = []
        for d in deck:
            c = _mk_card(d)
            cards[c.id] = c
            ids.append(c.id)
        random.shuffle(ids)
        return ids

    pA.library = load_into(deckA or [])
    pB.library = load_into(deckB or [])

    # FIX: correct field name is room_id (not id)
    return RoomState(room_id=room_id, players={"A": pA, "B": pB}, cards=cards)

def apply_action(s: RoomState, action_type: str, p: dict) -> RoomState:
    if action_type == "draw":
        pid = p["player_id"]; n = int(p.get("n",1))
        pl = s.players[pid]
        for _ in range(n):
            if pl.library:
                pl.hand.append(pl.library.pop())
        return s
    if action_type == "move":
        pid = p["player_id"]; cid = p["card_id"]; to = p["to"]
        pl = s.players[pid]
        zones = ["hand","battlefield","graveyard","exile","library"]
        for z in zones:
            arr = getattr(pl, z)
            if cid in arr:
                arr.remove(cid)
                break
        getattr(pl, to).append(cid)
        return s
    if action_type == "tap_toggle":
        cid = p["card_id"]
        s.cards[cid].tapped = not s.cards[cid].tapped
        return s
    if action_type == "life":
        pid = p["player_id"]; delta = int(p["delta"])
        s.players[pid].life += delta
        return s
    if action_type == "wins":
        pid = p["player_id"]; delta = int(p["delta"])
        s.players[pid].wins = max(0, s.players[pid].wins + delta)
        return s
    if action_type == "pass_turn":
        s.turn = "B" if s.turn == "A" else "A"
        s.phase = "Main"
        return s
    if action_type == "set_phase":
        s.phase = str(p["phase"])
        return s
    if action_type == "shuffle_library":
        pid = p["player_id"]
        random.shuffle(s.players[pid].library)
        return s
    if action_type == "swap_zone_with_hand":
        pid = p["player_id"]; zone = p["zone"]
        assert zone in ("graveyard","exile","library")
        pl = s.players[pid]
        other = getattr(pl, zone)
        pl.hand, other[:] = other[:], pl.hand[:]
        setattr(pl, zone, other)
        return s
    return s
