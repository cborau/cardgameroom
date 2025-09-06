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
  // keyboard shortcuts for Draw (D) and Pass (P)
  document.addEventListener("keydown", e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if (key === 'd') sendAction("draw", { player_id: me.id, n: 1 });
    if (key === 'p') sendAction("pass_turn", {});
    if (key === 'h') sendAction("toggle_show_hand", { player_id: me.id });
    if (key === 't') sendAction("toggle_show_top", { player_id: me.id });
    if (key === 'n') {
      // Next phase shortcut
      const phases = ["Untap","Upkeep","Draw","Main","Combat","Second Main","End"];
      const idx = phases.indexOf(state.phase);
      const next = phases[(idx + 1) % phases.length];
      sendAction("set_phase", { phase: next });
    }
    if (key === 's') {
      // Shuffle shortcut
      sendAction("shuffle_library", { player_id: me.id });
      const lib = $("#myLibrary"); lib.classList.add("shuffled");
      setTimeout(() => lib.classList.remove("shuffled"), 1000);
    }
  });
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
  // token styling: token_kind is 'creature' or 'chip'
  if (c.is_token) {
    el.classList.add("token", c.token_kind);
  }
  el.dataset.id = String(cid);
  el.dataset.name = c.name || "";
  el.title = c.name;
  const label = document.createElement("div");
  label.className = "label";
  // for chip tokens, show text; else show name
  label.textContent = (c.is_token && c.token_kind === 'chip') ? (c.text || c.name) : c.name;
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
  // for chip tokens, reposition on drag end
  if (c.is_token && c.token_kind === 'chip') {
    el.addEventListener('dragend', e => {
      e.preventDefault();
      const zone = document.getElementById('myBattlefield');
      const rect = zone.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      x = Math.max(0, Math.min(x, rect.width));
      y = Math.max(0, Math.min(y, rect.height));
      const z = Date.now() % 1000000;
      sendAction('set_card_pos', { card_id: cid, x: Math.round(x), y: Math.round(y), z });
    });
    // remove drop positioning for chips
  }
  // allow right-click removal for all tokens (including creatures)
  if (c.is_token) {
    el.oncontextmenu = e => {
      e.preventDefault();
      if (confirm('Remove token?')) sendAction('remove_token', { player_id: me.id, card_id: cid });
    };
  }
  // Add right-click context menu for cards in hand (non-tokens only)
  else if (ownerPid === me.id) {
    el.addEventListener('contextmenu', e => {
      const handZone = e.target.closest('#myHand');
      if (handZone) {
        e.preventDefault();
        if (confirm('Put this card at the bottom of your library?')) {
          sendAction('put_on_bottom', { player_id: me.id, card_id: cid });
        }
      }
    });
  }
  
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

// Create a non-draggable display-only version of a card element
function makeDisplayCardEl(cid) {
  const c = state.cards[cid];
  const el = document.createElement("div");
  el.className = "card displayOnly";
  // token styling: token_kind is 'creature' or 'chip'
  if (c.is_token) {
    el.classList.add("token", c.token_kind);
  }
  el.dataset.id = String(cid);
  el.dataset.name = c.name || "";
  el.title = c.name;
  const label = document.createElement("div");
  label.className = "label";
  // for chip tokens, show text; else show name
  label.textContent = (c.is_token && c.token_kind === 'chip') ? (c.text || c.name) : c.name;
  el.appendChild(label);

  const url = imgUrlFor(c);
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add("hasImage");
    el.ondblclick = () => showZoom(url);
    el.addEventListener("wheel", e => { e.preventDefault(); showZoom(url); });
  }
  if (c.tapped) el.classList.add("tapped");

  // NO drag functionality - this is display only
  el.draggable = false;

  return el;
}

// Apply absolute position from card state (used for battlefield)
function applyCardPos(el, pos) {
  if (!el) return;
  if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
    el.style.setProperty('--x', pos.x + 'px');
    el.style.setProperty('--y', pos.y + 'px');
    el.style.setProperty('--z', String(pos.z || 1));
  } else {
    el.style.removeProperty('--x');
    el.style.removeProperty('--y');
    el.style.removeProperty('--z');
  }
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
  const self = (me && me.id === 'B') ? B : A;
  const opp  = (me && me.id === 'B') ? A : B;


  $("#turn").textContent = state.turn === "A" ? (A.name || "Me") : (B.name || "Opponent");
  $("#phase").textContent = state.phase;

  // Swap labels for current player (self) and opponent (opp) based on me.id
  $("#nameA").textContent = self.name || `Player ${me.id}`;
  $("#nameB").textContent = opp.name || `Player ${me.id === 'B' ? 'A' : 'B'}`;
  $("#winsValA").textContent = self.wins;
  $("#winsB").textContent = `Wins: ${opp.wins}`;
  $("#lifeValA").textContent = self.life;
  $("#lifeB").textContent = `Life: ${opp.life}`;

  // Update button states to show when features are active
  const showHandBtn = document.getElementById("showHandBtn");
  const showTopBtn = document.getElementById("showTopBtn");
  if (showHandBtn) {
    showHandBtn.textContent = self.show_hand ? "Hide Hand (H)" : "Show Hand (H)";
    showHandBtn.classList.toggle("active", self.show_hand);
  }
  if (showTopBtn) {
    showTopBtn.textContent = self.show_top ? "Hide Top (T)" : "Show Top (T)";
    showTopBtn.classList.toggle("active", self.show_top);
  }

  // Opponent zones
  // Check if opponent wants to show the top card of their library
  const showOppTop = opp.show_top;
  zoneThumb($("#oppLibrary"), opp.library, "Library", {showBack: !showOppTop});
  zoneThumb($("#oppExile"),   opp.exile,   "Exile");
  zoneThumb($("#oppGraveyard"), opp.graveyard, "Graveyard");

  const oppBF = $("#oppBattlefield"); clearZone(oppBF);
  opp.battlefield.forEach(cid => {
    const el = makeCardEl(cid, (me && me.id === "B") ? "A" : "B");
    applyCardPos(el, state.cards[cid] && state.cards[cid].pos);
    oppBF.appendChild(el);
  });

  const oppHand = $("#oppHand"); clearZone(oppHand);
  // Check if opponent wants to show their hand
  if (opp.show_hand) {
    // Show actual cards in opponent's hand (but non-draggable)
    opp.hand.forEach(cid => {
      const el = makeDisplayCardEl(cid);
      oppHand.appendChild(el);
    });
  } else {
    // Show face-down cards as before
    opp.hand.forEach(_cid => {
      const el = document.createElement("div");
      el.className = "card faceDown";
      oppHand.appendChild(el);
    });
  }

  // My zones
  const lib = $("#myLibrary"); lib.dataset.zone = "library";
  // Check if I want to show the top card of my library
  const showMyTop = self.show_top;
  zoneThumb(lib, self.library, "Library", {showBack: !showMyTop, clickable:true});

  const exi = $("#myExile"); exi.dataset.zone = "exile";
  zoneThumb(exi, self.exile, "Exile", {clickable:true});

  const gry = $("#myGraveyard"); gry.dataset.zone = "graveyard";
  zoneThumb(gry, self.graveyard, "Graveyard", {clickable:true});

  const myBF = $("#myBattlefield"); clearZone(myBF);
  self.battlefield.forEach(cid => {
    const el = makeCardEl(cid, me.id || "A");
    applyCardPos(el, state.cards[cid] && state.cards[cid].pos);
    myBF.appendChild(el);
  });

  const myHand = $("#myHand"); clearZone(myHand);
  self.hand.forEach(cid => myHand.appendChild(makeCardEl(cid, me.id || "A")));

  // Render my tokens
  const tray = document.getElementById('myTokenTray');
  clearZone(tray);
  state.players[me.id].token_tray.forEach(cid => {
    const tok = state.cards[cid];
    const el = document.createElement('div');
    el.className = 'card token chip';
    // add content label
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = tok.text || tok.name;
    el.appendChild(label);

    el.onclick = () => {
      const newText = prompt('Edit token', tok.text || tok.name);
      if (newText != null) sendAction('update_token', { player_id: me.id, card_id: cid, text: newText });
    };
    el.oncontextmenu = e => {
      e.preventDefault();
      if (confirm('Remove token?')) sendAction('remove_token', { player_id: me.id, card_id: cid });
    };
    tray.appendChild(el);
  });
}

// DnD targets (unchanged)
function setupDnD() {
  $$(".droptarget").forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("highlight"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("highlight"));
    // unchanged drop logic for moving cards
    zone.addEventListener("drop", e => {
      e.preventDefault(); zone.classList.remove("highlight");
      let data;
      try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch {}
      if (!data) return;
      const to = zone.dataset.zone;
      
      // Determine target player: if dropping on opponent's zone, use opponent's ID
      let targetPlayerId = me.id; // default to my ID
      if (zone.dataset.owner === "opponent") {
        // This is an opponent's zone, so use opponent's ID
        targetPlayerId = me.id === "A" ? "B" : "A";
      }
      
      sendAction("move", { player_id: targetPlayerId, card_id: data.card_id, to });
      if (to === "battlefield") {
        // absolute pos logic
        const rect = zone.getBoundingClientRect();
        const hCss = getComputedStyle(zone).getPropertyValue('--card-h').trim();
        let h = parseFloat(hCss);
        if (!isFinite(h) || h <= 0) h = Math.max(16, zone.clientHeight * 0.95);
        const w = Math.round(h * 5 / 7);
        let x = e.clientX - rect.left - w / 2;
        let y = e.clientY - rect.top  - h / 2;

        // Snap-stack logic: if dropping near an existing card center, or Shift is held, offset onto that stack
        try {
          const cards = Array.from(zone.querySelectorAll('.card'));
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          let anchor = null, bestD = Infinity;
          const radius = 36;
          const name = (window.state && window.state.cards && window.state.cards[data.card_id] && window.state.cards[data.card_id].name) || '';

          for (const c of cards) {
            // Skip if it's the same card being moved within BF before DOM updates
            const cidAttr = c.getAttribute('data-id');
            if (cidAttr && cidAttr === String(data.card_id)) continue;
            const cx = parseFloat(c.style.getPropertyValue('--x') || '0') + w/2;
            const cy = parseFloat(c.style.getPropertyValue('--y') || '0') + h/2;
            const d = Math.hypot(px - cx, py - cy);
            const same = name && c.title && c.title === name;
            if ((same && d < radius) || (e.shiftKey && d < radius)) {
              if (d < bestD) { bestD = d; anchor = c; }
            }
          }

          if (anchor) {
            // Count existing cards near anchor to offset
            let depth = 0;
            for (const c of cards) {
              const ax = parseFloat(anchor.style.getPropertyValue('--x') || '0');
              const ay = parseFloat(anchor.style.getPropertyValue('--y') || '0');
              const ox = parseFloat(c.style.getPropertyValue('--x') || '0');
              const oy = parseFloat(c.style.getPropertyValue('--y') || '0');
              if (Math.hypot(ox - ax, oy - ay) < 28) depth++;
            }
            const off = 18 * 0.7;
            x = parseFloat(anchor.style.getPropertyValue('--x') || '0') + depth * off;
            y = parseFloat(anchor.style.getPropertyValue('--y') || '0') + depth * off;
          }
        } catch {}

        // Clamp and send
        x = Math.max(0, Math.min(x, rect.width  - w));
        y = Math.max(0, Math.min(y, rect.height - h));
        const z = Date.now() % 1000000;
        sendAction("set_card_pos", { card_id: data.card_id, x: Math.round(x), y: Math.round(y), z });
      }

    });
  });
}

// Header buttons (unchanged)
function wireButtons() {
  const by = s => document.querySelector(`[data-act='${s}']`);
  // action buttons
  by('mulligan').onclick = () => sendAction("mulligan", { player_id: me.id, n: 7 });
  by('draw').onclick     = () => sendAction("draw",     { player_id: me.id, n: 1 });
  by('nextPhase').onclick= () => {
    const phases = ["Untap","Upkeep","Draw","Main","Combat","Second Main","End"];
    const idx = phases.indexOf(state.phase);
    const next = phases[(idx + 1) % phases.length];
    sendAction("set_phase", { phase: next });
  };
  by('pass').onclick     = () => sendAction("pass_turn", {});
  by('shuffle').onclick  = () => {
    sendAction("shuffle_library", { player_id: me.id });
    const lib = $("#myLibrary"); lib.classList.add("shuffled");
    setTimeout(() => lib.classList.remove("shuffled"), 1000);
  };
  by('createCreature').onclick = async () => {
    const name = prompt('Creature token name', 'Token Creature');
    if (!name) return;
    sendAction('create_token', { player_id: me.id, name, creature: true, text: name });
  };
  by('createMarker').onclick = async () => {
    const text = prompt('Marker token text', '+1/+1');
    if (!text) return;
    sendAction('create_token', { player_id: me.id, name: 'Marker', creature: false, text });
  };
  by('showHand').onclick = () => {
    sendAction('toggle_show_hand', { player_id: me.id });
  };
  by('showTop').onclick = () => {
    sendAction('toggle_show_top', { player_id: me.id });
  };

  // Handle life and wins controls for current player
  $("#lifeA").addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const [, delta] = (t.dataset.wins ? [] : (t.dataset.life || "")).split(",");
    if (delta) sendAction("life", { player_id: me.id, delta: parseInt(delta, 10) });
  });
  $("#winsA").addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const [, delta] = (t.dataset.wins || "").split(",");
    sendAction("wins", { player_id: me.id, delta: parseInt(delta, 10) });
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

// === Card sizing controls =====================================================
(() => {
  const zones = {
    A: {
      hand: document.getElementById('myHand'),
      bf:   document.getElementById('myBattlefield'),
      slider: document.getElementById('scaleASlider'),
      readout: document.getElementById('scaleAVal'),
    },
    B: {
      hand: document.getElementById('oppHand'),
      bf:   document.getElementById('oppBattlefield'),
      slider: document.getElementById('scaleBSlider'),
      readout: document.getElementById('scaleBVal'),
    }
  };

  const scalePct = { A: 100, B: 100 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v|0));

  function setZoneCardHeight(zoneEl, pct) {
    if (!zoneEl) return;
    const innerH = Math.max(0, zoneEl.clientHeight - 12);
    const px = Math.max(16, Math.floor(innerH * (clamp(pct, 30, 100) / 100)));
    zoneEl.style.setProperty('--card-h', px + 'px');
  }

  function applyScale(who, pct) {
    scalePct[who] = clamp(pct, 30, 100);
    const z = zones[who];
    setZoneCardHeight(z.hand, scalePct[who]);
    setZoneCardHeight(z.bf,   scalePct[who]);
    if (z.readout) z.readout.textContent = scalePct[who] + '%';
  }

  function recalcAll() {
    applyScale('A', scalePct.A);
    applyScale('B', scalePct.B);
  }

  ['A','B'].forEach(who => {
    const z = zones[who];
    if (z && z.slider) {
      z.slider.addEventListener('input', (e) => {
        const val = clamp(parseInt(e.target.value || '100', 10), 30, 100);
        applyScale(who, val);
      });
    }
  });

  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const el = entry.target;
      const who = (el.id.startsWith('my')) ? 'A' : 'B';
      const pct = scalePct[who];
      setZoneCardHeight(el, pct);
    }
  });

  if (zones.A.hand) ro.observe(zones.A.hand);
  if (zones.A.bf)   ro.observe(zones.A.bf);
  if (zones.B.hand) ro.observe(zones.B.hand);
  if (zones.B.bf)   ro.observe(zones.B.bf);

  window.addEventListener('resize', recalcAll);

  window.addEventListener('load', () => {
    recalcAll();
    setTimeout(recalcAll, 150);
    setTimeout(recalcAll, 400);
  });
})();
