const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const tmpl = $("#cardTmpl");

let ws, roomId, me = { id: "A", name: "" }, state = null;

function connect() {
  ws = new WebSocket(`${location.protocol.replace("http","ws")}//${location.host}/ws/${roomId}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ kind:"hello", room_id: roomId, player_id: me.id, name: me.name }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.kind === "state") {
      state = msg.state;
      render();
    }
  };
  ws.onclose = () => console.warn("Socket closed");
}

function sendAction(type, payload) {
  ws.send(JSON.stringify({ kind:"action", type, payload }));
}

function render() {
  $("#turn").textContent = state.turn;
  $("#phase").textContent = state.phase;

  $("#lifeValA").textContent = state.players.A.life;
  $("#lifeValB").textContent = state.players.B.life;
  $("#nameA").textContent = state.players.A.name;
  $("#nameB").textContent = state.players.B.name;

  // zones
  renderPlayer("A", true);
  renderPlayer("B", false);
}

function renderPlayer(pid, isTop) {
  const p = state.players[pid];
  const opp = pid !== me.id;

  const bf = pid===me.id ? $("#myBattlefield") : $("#oppBattlefield");
  const hand = pid===me.id ? $("#myHand") : $("#oppHand");
  const lib = pid===me.id ? $$('[data-zone="library"]')[0] : $("#oppLibrary");
  const gy = pid===me.id ? $$('[data-zone="graveyard"]')[0] : $("#oppGraveyard");
  const ex = pid===me.id ? $$('[data-zone="exile"]')[0] : $("#oppExile");

  // clear
  [bf, hand, lib, gy, ex].forEach(el => { if (el) el.innerHTML = ""; });

  // library, graveyard, exile show counters only
  if (lib) lib.textContent = `Library (${p.library.length})`;
  if (gy) gy.textContent = `Graveyard (${p.graveyard.length})`;
  if (ex) ex.textContent = `Exile (${p.exile.length})`;

  // battlefield
  for (const cid of p.battlefield) {
    const c = cardEl(cid, pid);
    c.classList.toggle("tapped", state.cards[cid].tapped);
    c.onclick = () => sendAction("tap_toggle", { card_id: cid });
    bf.appendChild(c);
  }

  // hand
  for (const cid of p.hand) {
    const c = cardEl(cid, pid);
    if (opp && !p.revealed_hand) c.classList.add("faceDown");
    hand.appendChild(c);
  }
}

function normalizeImgPath(p) {
  if (!p) return null;
  const s = p.replace(/\\/g, "/");
  if (s.startsWith("http")) return s;
  if (s.startsWith("/images/")) return s;
  if (s.startsWith("images/")) return "/" + s;
  // fallback: treat as filename under /images
  return "/images/" + s;
}

function showZoom(url) {
  const z = $("#zoom"), img = $("#zoomImg");
  img.src = url; z.classList.remove("hidden");
}
$("#zoom")?.addEventListener("click", () => $("#zoom").classList.add("hidden"));

function cardEl(cid, ownerPid) {
  const card = state.cards[cid];
  const el = tmpl.content.firstElementChild.cloneNode(true);
  el.dataset.id = cid;
  el.querySelector(".label").textContent = card.name;

  const url = normalizeImgPath(card.image);
  if (url) {
    el.style.backgroundImage = `url('${url}')`;
    el.classList.add("hasImage");
    el.ondblclick = () => showZoom(url); // double click to zoom image
  }

  if (ownerPid === me.id) {
    el.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", cid);
      e.dataTransfer.effectAllowed = "move";
    });
  }
  return el;
}

function setupDnD() {
  $$(".droptarget").forEach(zone => {
    zone.addEventListener("dragenter", e => zone.classList.add("highlight"));
    zone.addEventListener("dragleave", e => zone.classList.remove("highlight"));
    zone.addEventListener("dragover", e => e.preventDefault());
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("highlight");
      const cid = e.dataTransfer.getData("text/plain");
      const to = zone.dataset.zone;
      sendAction("move", { player_id: me.id, from:"any", to, card_id: cid });
    });
  });
}

function joinFlow() {
  $("#btnJoin").onclick = () => {
    roomId = $("#room").value.trim() || "TEST";
    me.id = $("#seat").value;
    me.name = $("#name").value.trim() || (me.id === "A" ? "Player A" : "Player B");
    $("#join").classList.add("hidden");
    $("#table").classList.remove("hidden");
    connect();
  };
}

function shortcuts() {
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "d" || e.key === "D") sendAction("draw", { player_id: me.id, n:1 });
    if (e.key === "p" || e.key === "P") sendAction("pass_turn", {});
  });
}

function wireButtons() {
  $(".controls [data-act='draw']").onclick = () => sendAction("draw", { player_id: me.id, n:1 });
  $(".controls [data-act='pass']").onclick = () => sendAction("pass_turn", {});
  $(".controls [data-act='shuffle']").onclick = () => sendAction("shuffle_library", { player_id: me.id });
  $(".controls [data-act='reveal']").onclick = () => {
    const val = !state.players[me.id].revealed_hand;
    sendAction("reveal_hand", { player_id: me.id, value: val });
  };
  $(".controls [data-act='save']").onclick = () => fetch(`/api/save/${roomId}`, {method:"POST"});
  $(".controls [data-act='load']").onclick = () => fetch(`/api/load/${roomId}`, {method:"POST"});

  $$("[data-life]").forEach(b => b.onclick = () => {
    const [pid, delta] = b.dataset.life.split(",");
    sendAction("life", { player_id: pid, delta: parseInt(delta,10) });
  });
}

joinFlow();
setupDnD();
shortcuts();
wireButtons();
