const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

let ws, roomId, me = { id:"A", name:"", deck:"" }, state = null;

// ---- boot
document.addEventListener("DOMContentLoaded", () => {
  joinFlow();
  setupDnD();
  wireButtons();
  wireZoneClicks();
  loadDecks();
});

// ---- deck list
async function loadDecks() {
  try {
    const res = await fetch("/api/decks");
    const data = await res.json();
    const sel = $("#deck");
    if (!sel) return;
    sel.innerHTML = "";
    (data.decks || []).forEach(d => {
      const opt = document.createElement("option");
      opt.value = d; opt.textContent = d;
      sel.appendChild(opt);
    });
    if (!sel.value && sel.options.length) sel.value = sel.options[0].value;
    $("#deckRow").style.display = sel.options.length ? "block" : "none";
  } catch {
    const row = $("#deckRow"); if (row) row.style.display = "none";
  }
}

// ---- join
function joinFlow() {
  const btn = $("#joinBtn");
  if (!btn) return;
  btn.onclick = () => {
    roomId = $("#room").value.trim() || "TEST";
    me.id = $("#seat").value || "A";
    me.name = $("#pname").value.trim();
    const deckSel = $("#deck");
    me.deck = deckSel && deckSel.value ? deckSel.value : "";

    $("#join").classList.add("hidden");
    $("#app").classList.remove("hidden");
    connect();
  };
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${encodeURIComponent(roomId)}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      kind: "hello",
      room_id: roomId,
      player_id: me.id,
      name: me.name || undefined,
      deck: me.deck || undefined
    }));
  };

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.kind === "state") { state = msg.state; render(); }
  };
}

// ---- actions
function sendAction(type, payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ kind: "action", type, payload }));
}

// Make image URLs robust to backslashes and stray prefixes.
function imgUrlFor(card) {
  if (!card || !card.image) return null;
  let p = String(card.image).replace(/\\/g, "/");
  const i = p.toLowerCase().lastIndexOf("images/");
  if (i >= 0) p = p.slice(i);            // keep from "images/..."
  if (!p.startsWith("/")) p = "/" + p;   // ensure absolute
  return p;
}

function makeCardEl(cid, ownerPid) {
  const c = state.cards[cid];
  const el = document.createElement("div");
  el.className = "card";
  el.title = c.name;
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = c.name;
  el.appendChild(label);

  const url = imgUrlFor(c);
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add("hasImage");
    el.ondblclick = () => showZoom(url);
    el.addEventListener("wheel", e => { e.preventDefault(); showZoom(url); });
  }
  if (c.tapped) el.classList.add("tapped");

  // drag
  el.draggable = true;
  el.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ card_id: cid, owner: ownerPid }));
  });

  // tap/untap with simple click on battlefield cards
  el.addEventListener("click", e => {
    // Only tap if the card is on the battlefield (not in hand or other zones)
    const battlefield = e.target.closest('#myBattlefield') || e.target.closest('#oppBattlefield');
    if (battlefield && ownerPid === me.id) {
      sendAction("tap_toggle", { card_id: cid });
    }
  });
  return el;
}

// Only clear dynamic children; preserve the .zoneLabel element
function clearZone(el) {
  const lab = el.querySelector(".zoneLabel");
  el.innerHTML = "";
  if (lab) el.appendChild(lab);
}

function zoneThumb(el, ids, _label, {showBack=false, clickable=false} = {}) {
  clearZone(el);
  el.style.backgroundImage = "";
  el.classList.toggle("clickableEnabled", clickable);

  const count = document.createElement("div");
  count.className = "thumbCount";
  count.textContent = `${ids.length}`;
  el.appendChild(count);

  if (showBack) {
    el.style.backgroundImage = `url("/static/assets/cardback.png")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
  } else if (ids.length) {
    const last = state.cards[ids[ids.length - 1]];
    const u = imgUrlFor(last);
    if (u) {
      el.style.backgroundImage = `url("${u}")`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    }
  }
}

function render() {
  if (!state) return;
  const A = state.players.A, B = state.players.B;

  $("#turn").textContent = state.turn === "A" ? (A.name || "Me") : (B.name || "Opponent");
  $("#phase").textContent = state.phase;

  $("#nameA").textContent = A.name || "Player A";
  $("#nameB").textContent = B.name || "Player B";
  $("#winsValA").textContent = A.wins;
  $("#winsB").textContent = `Wins: ${B.wins}`;
  $("#lifeValA").textContent = A.life;
  $("#lifeB").textContent = `Life: ${B.life}`;

  // Opponent zones
  zoneThumb($("#oppLibrary"), B.library, "Library", {showBack:true});
  zoneThumb($("#oppExile"),   B.exile,   "Exile");
  zoneThumb($("#oppGraveyard"), B.graveyard, "Graveyard");

  const oppBF = $("#oppBattlefield"); clearZone(oppBF);
  B.battlefield.forEach(cid => oppBF.appendChild(makeCardEl(cid, "B")));

  const oppHand = $("#oppHand"); clearZone(oppHand);
  B.hand.forEach(_cid => {
    const el = document.createElement("div");
    el.className = "card faceDown";
    oppHand.appendChild(el);
  });

  // My zones
  const lib = $("#myLibrary"); lib.dataset.zone = "library";
  zoneThumb(lib, A.library, "Library", {showBack:true, clickable:true});

  const exi = $("#myExile"); exi.dataset.zone = "exile";
  zoneThumb(exi, A.exile, "Exile", {clickable:true});

  const gry = $("#myGraveyard"); gry.dataset.zone = "graveyard";
  zoneThumb(gry, A.graveyard, "Graveyard", {clickable:true});

  const myBF = $("#myBattlefield"); clearZone(myBF);
  A.battlefield.forEach(cid => myBF.appendChild(makeCardEl(cid, "A")));

  const myHand = $("#myHand"); clearZone(myHand);
  A.hand.forEach(cid => myHand.appendChild(makeCardEl(cid, "A")));
}

// DnD targets (unchanged)
function setupDnD() {
  $$(".droptarget").forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("highlight"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("highlight"));
    zone.addEventListener("drop", e => {
      e.preventDefault(); zone.classList.remove("highlight");
      let data;
      try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch {}
      if (!data) return;
      const to = zone.dataset.zone;
      sendAction("move", { player_id: me.id, card_id: data.card_id, to });
    });
  });
}

// Header buttons (unchanged)
function wireButtons() {
  const by = s => document.querySelector(`[data-act='${s}']`);
  by('draw').onclick = () => sendAction("draw", { player_id: me.id, n: 1 });
  by('pass').onclick = () => sendAction("pass_turn", {});
  by('shuffle').onclick = () => sendAction("shuffle_library", { player_id: me.id });
  by('save').onclick = async () => { await fetch(`/api/save/${roomId}`, {method:"POST"}); };
  by('load').onclick = async () => { await fetch(`/api/load/${roomId}`, {method:"POST"}); };

  $("#lifeA").addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const [, delta] = (t.dataset.wins ? [] : (t.dataset.life || "")).split(",");
    if (delta) sendAction("life", { player_id: "A", delta: parseInt(delta,10) });
  });
  $("#winsA").addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const [, delta] = (t.dataset.wins || "").split(",");
    sendAction("wins", { player_id: "A", delta: parseInt(delta,10) });
  });
}

// Click/double-click behavior on zones
function wireZoneClicks() {
  // Library: click => draw; double-click => swap with hand
  const lib = $("#myLibrary");
  let clickTimer = null;
  lib.addEventListener("click", () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => sendAction("draw", { player_id: me.id, n: 1 }), 180);
  });
  lib.addEventListener("dblclick", () => {
    clearTimeout(clickTimer);
    sendAction("swap_zone_with_hand", { player_id: me.id, zone: "library" });
  });

  // Exile/Graveyard: double-click to swap with hand
  ["myExile", "myGraveyard"].forEach(id => {
    const el = $("#" + id);
    el.addEventListener("dblclick", () => {
      const zone = el.id === "myExile" ? "exile" : "graveyard";
      sendAction("swap_zone_with_hand", { player_id: me.id, zone });
    });
  });
}

// Zoom overlay
function showZoom(url) {
  const z = $("#zoom"), img = $("#zoomImg");
  img.src = url; z.classList.remove("hidden");
}
$("#zoom").addEventListener("click", () => $("#zoom").classList.add("hidden"));
$("#zoom").addEventListener("wheel", e => { e.preventDefault(); $("#zoom").classList.add("hidden"); });
