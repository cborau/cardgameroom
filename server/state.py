import random, time, uuid
from typing import Dict, List
from pydantic import BaseModel
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

def new_room(room_id: str, p1_deck: List[str], p2_deck: List[str]) -> RoomState:
    cards: Dict[str, CardInstance] = {}
    p1_ids = []
    p2_ids = []
    for d in p1_deck:
        ci = _mk_card(d)
        cards[ci.id] = ci
        p1_ids.append(ci.id)
    for d in p2_deck:
        ci = _mk_card(d)
        cards[ci.id] = ci
        p2_ids.append(ci.id)
    random.Random(room_id).shuffle(p1_ids)
    random.Random(room_id[::-1]).shuffle(p2_ids)
    return RoomState(
        room_id=room_id,
        turn="A",
        players={
            "A": PlayerState(id="A", name="Player A", library=p1_ids),
            "B": PlayerState(id="B", name="Player B", library=p2_ids),
        },
        cards=cards,
    )

def apply_action(state: RoomState, action_type: str, p: Dict) -> RoomState:
    s = state
    if action_type == "set_name":
        pid = p["player_id"]; name = p["name"][:24]
        s.players[pid].name = name
        return s

    if action_type == "draw":
        pid = p["player_id"]; n = int(p.get("n",1))
        for _ in range(n):
            if s.players[pid].library:
                cid = s.players[pid].library.pop()
                s.players[pid].hand.append(cid)
        return s

    if action_type == "move":
        # move card between zones. zones: library, hand, battlefield, graveyard, exile
        cid = p["card_id"]; src = p["from"]; dst = p["to"]; pid = p["player_id"]
        zones = s.players[pid]
        sources = [src] if src != "any" else ["hand","battlefield","graveyard","exile","library"]
        removed = False
        for z in sources:
            lst = getattr(zones, z)
            if cid in lst:
                lst.remove(cid)
                removed = True
                break
        if not removed:
            return s
        getattr(zones, dst).append(cid)
        return s

    if action_type == "tap_toggle":
        cid = p["card_id"]
        s.cards[cid].tapped = not s.cards[cid].tapped
        return s

    if action_type == "life":
        pid = p["player_id"]; delta = int(p["delta"])
        s.players[pid].life += delta
        return s

    if action_type == "reveal_hand":
        pid = p["player_id"]; val = bool(p["value"])
        s.players[pid].revealed_hand = val
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

    return s
