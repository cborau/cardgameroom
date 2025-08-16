from server.state import new_room, apply_action
from server.models import RoomState

def _make():
    s = new_room("T123", [f"A{i}" for i in range(5)], [f"B{i}" for i in range(5)])
    return s

def test_draw_moves_from_library_to_hand():
    s = _make()
    lib0 = len(s.players["A"].library)
    s = apply_action(s, "draw", {"player_id":"A","n":2})
    assert len(s.players["A"].hand) == 2
    assert len(s.players["A"].library) == lib0 - 2

def test_move_to_battlefield_and_tap():
    s = _make()
    s = apply_action(s, "draw", {"player_id":"A","n":1})
    cid = s.players["A"].hand[0]
    s = apply_action(s, "move", {"player_id":"A","from":"hand","to":"battlefield","card_id":cid})
    assert cid in s.players["A"].battlefield
    s = apply_action(s, "tap_toggle", {"card_id": cid})
    assert s.cards[cid].tapped is True

def test_life_and_pass_turn():
    s = _make()
    s = apply_action(s, "life", {"player_id":"A","delta":-3})
    assert s.players["A"].life == 17
    old = s.turn
    s = apply_action(s, "pass_turn", {})
    assert s.turn != old
    

def test_swap_zone_with_hand():
    st: RoomState = new_room("T", [], [])
    # seed some fake cards directly
    st.players["A"].hand = ["h1","h2"]
    st.players["A"].graveyard = ["g1"]
    st.cards["h1"] = st.cards["h2"] = st.cards.setdefault("x", None) or {}
    st.cards["g1"] = {}
    apply_action(st, "swap_zone_with_hand", {"player_id":"A", "zone":"graveyard"})
    assert st.players["A"].hand == ["g1"]
    assert st.players["A"].graveyard == ["h1","h2"]

