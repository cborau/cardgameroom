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
  el.dataset.id = String(cid);
  el.dataset.name = c.name || "";
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

  $("#nameA").textContent = A.name || "Player A";
  $("#nameB").textContent = B.name || "Player B";
  $("#winsValA").textContent = A.wins;
  $("#winsB").textContent = `Wins: ${B.wins}`;
  $("#lifeValA").textContent = A.life;
  $("#lifeB").textContent = `Life: ${B.life}`;

  // Opponent zones
  zoneThumb($("#oppLibrary"), opp.library, "Library", {showBack:true});
  zoneThumb($("#oppExile"),   opp.exile,   "Exile");
  zoneThumb($("#oppGraveyard"), opp.graveyard, "Graveyard");

  const oppBF = $("#oppBattlefield"); clearZone(oppBF);
  opp.battlefield.forEach(cid => {
    const el = makeCardEl(cid, (me && me.id === "B") ? "A" : "B");
    applyCardPos(el, state.cards[cid] && state.cards[cid].pos);
    oppBF.appendChild(el);
  });

  const oppHand = $("#oppHand"); clearZone(oppHand);
  opp.hand.forEach(_cid => {
    const el = document.createElement("div");
    el.className = "card faceDown";
    oppHand.appendChild(el);
  });

  // My zones
  const lib = $("#myLibrary"); lib.dataset.zone = "library";
  zoneThumb(lib, self.library, "Library", {showBack:true, clickable:true});

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
      // Also set absolute position when dropping on battlefield

      if (to === "battlefield") {
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
