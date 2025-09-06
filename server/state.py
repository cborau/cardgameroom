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
    # draw opening hands
    for _ in range(7):
        if pA.library:
            pA.hand.append(pA.library.pop())
    for _ in range(7):
        if pB.library:
            pB.hand.append(pB.library.pop())

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
        target_player = s.players[pid]
        zones = ["hand","battlefield","graveyard","exile","library"]
        
        # Find the card in ANY player's zones (not just the target player)
        found_in_player = None
        found_in_zone = None
        for player_id, player in s.players.items():
            for zone_name in zones:
                zone_cards = getattr(player, zone_name)
                if cid in zone_cards:
                    found_in_player = player
                    found_in_zone = zone_cards
                    break
            if found_in_player:
                break
        
        # Remove from current location and add to target
        if found_in_zone is not None:
            found_in_zone.remove(cid)
            getattr(target_player, to).append(cid)

        # Position handling: only relevant on battlefield
        if to != "battlefield":
            if cid in s.cards:
                s.cards[cid].pos = None
        else:
            if cid in s.cards and not s.cards[cid].pos:
                s.cards[cid].pos = {"x": 0, "y": 0, "z": 1}
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
    if action_type == "mulligan":
        pid = p["player_id"]; n = int(p.get("n", 7))
        pl = s.players[pid]
        # return hand to library and shuffle
        pl.library.extend(pl.hand)
        pl.hand.clear()
        random.shuffle(pl.library)
        # draw n cards
        for _ in range(n):
            if pl.library:
                pl.hand.append(pl.library.pop())
        return s
    if action_type == "swap_zone_with_hand":
        pid = p["player_id"]; zone = p["zone"]
        assert zone in ("graveyard","exile","library")
        pl = s.players[pid]
        other = getattr(pl, zone)
        pl.hand, other[:] = other[:], pl.hand[:]
        setattr(pl, zone, other)
        return s
    if action_type == "set_card_pos":
        cid = p["card_id"]
        if cid in s.cards:
            x = int(p.get("x", 0)); y = int(p.get("y", 0)); z = int(p.get("z", 1))
            s.cards[cid].pos = {"x": x, "y": y, "z": z}
        return s
    # -- Token management actions --
    if action_type == "create_token":
        pid = p["player_id"]
        tid = _uid()
        kind = "creature" if p.get("creature") else "chip"
        tok = CardInstance(id=tid,
                           name=p.get("name", "Token"),
                           is_token=True,
                           token_kind=kind,
                           text=p.get("text", None))
        s.cards[tid] = tok
        # always place tokens onto battlefield
        s.players[pid].battlefield.append(tid)
        return s
    if action_type == "update_token":
        cid = p["card_id"]
        tok = s.cards.get(cid)
        if tok and tok.is_token:
            tok.text = p.get("text", tok.text)
        return s
    if action_type == "remove_token":
        pid = p.get("player_id")
        cid = p.get("card_id")
        # remove from battlefield
        pl = s.players[pid]
        if cid in pl.battlefield:
            pl.battlefield.remove(cid)
        s.cards.pop(cid, None)
        return s
    if action_type == "put_on_bottom":
        pid = p["player_id"]
        cid = p["card_id"]
        pl = s.players[pid]
        # Remove card from hand
        if cid in pl.hand:
            pl.hand.remove(cid)
            # Put card at the bottom of library (beginning of the list since we pop from the end)
            pl.library.insert(0, cid)
        return s
    if action_type == "toggle_show_hand":
        pid = p["player_id"]
        s.players[pid].show_hand = not s.players[pid].show_hand
        return s
    if action_type == "toggle_show_top":
        pid = p["player_id"]
        s.players[pid].show_top = not s.players[pid].show_top
        return s

    return s
