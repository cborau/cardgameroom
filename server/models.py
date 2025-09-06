from typing import Dict, List, Optional, Literal
from pydantic import BaseModel, Field

Phase = Literal["Untap","Upkeep","Draw","Main","Combat","Second Main","End"]

class CardInstance(BaseModel):
    id: str
    name: str
    tapped: bool = False
    counters: Dict[str, int] = Field(default_factory=dict)
    image: Optional[str] = None
    scryfall_id: Optional[str] = None
    set: Optional[str] = None
    collector_number: Optional[str] = None
    pos: Optional[Dict[str, int]] = None  # {"x": int, "y": int, "z": int}
    # Token support fields
    is_token: bool = False
    # type of token: "creature" (card-like) or "chip" (small marker)
    token_kind: Literal["creature","chip"] = "creature"
    text: Optional[str] = None

class PlayerState(BaseModel):
    id: Literal["A","B"]
    name: str = "Player"
    life: int = 20
    wins: int = 0
    revealed_hand: bool = False
    show_hand: bool = False  # NEW: when True, hand is visible to opponents
    show_top: bool = False   # NEW: when True, top card of library is visible to all
    library: List[str] = Field(default_factory=list)
    hand: List[str] = Field(default_factory=list)
    battlefield: List[str] = Field(default_factory=list)
    graveyard: List[str] = Field(default_factory=list)
    exile: List[str] = Field(default_factory=list)

class RoomState(BaseModel):
    room_id: str
    turn: Literal["A","B"] = "A"
    phase: Phase = "Main"
    cards: Dict[str, CardInstance] = Field(default_factory=dict)
    players: Dict[Literal["A","B"], PlayerState] = Field(default_factory=dict)

class ClientHello(BaseModel):
    kind: Literal["hello"]
    room_id: str
    player_id: Literal["A","B"]
    name: Optional[str] = None
    deck: Optional[str] = None  # NEW

class ClientAction(BaseModel):
    kind: Literal["action"]
    type: str
    payload: Dict

class ServerState(BaseModel):
    kind: Literal["state"]
    state: RoomState

class ServerAck(BaseModel):
    kind: Literal["ack"]
    ok: bool
    msg: Optional[str] = None
