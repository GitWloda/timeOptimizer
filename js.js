const timeline = document.getElementById("timeline");
const sessionTitle = document.getElementById("sessionTitle");
const logEl = document.getElementById("log");
const currentStateLabel = document.getElementById("currentStateLabel");

const actionButtons = Array.from(document.querySelectorAll("button[data-state]"));
const toggleBtn = document.getElementById("toggle");
const resetBtn = document.getElementById("reset");

const exportJsonBtn = document.getElementById("exportJson");
const importJsonBtn = document.getElementById("importJsonBtn");
const importJsonInput = document.getElementById("importJsonInput");

const elSessionTime = document.getElementById("sessionTime");
const statEls = {
  pausa: document.getElementById("pausa"),
  lavoro: document.getElementById("lavoro"),
  studio: document.getElementById("studio"),
};

const rowPausa = document.getElementById("row-pausa");
const rowLavoro = document.getElementById("row-lavoro");
const rowStudio = document.getElementById("row-studio");

const dotPausa = document.getElementById("dot-pausa");
const dotLavoro = document.getElementById("dot-lavoro");
const dotStudio = document.getElementById("dot-studio");

const actualBar = document.getElementById("actual-bar");

const tooltip = document.getElementById("tooltip");
const tooltipArrow = document.getElementById("tooltipArrow");

// Config
const HIDE_TEXT_UNDER_PCT = 6;

// Stato sessione
let sessionIndex = 1;
let running = false;
let sessionElapsedMs = 0;
let runStartMs = null;

// Totali
const totalsMs = { pausa: 0, lavoro: 0, studio: 0 };

// Azione corrente
let currentState = null;
let stateStartMs = null;

// Ultima azione per resume
let lastActionState = null;
let lastActionColor = null;

// Segmenti
const segments = []; // { startS, endS, el, textEl, state, color, tipText, isTextHidden }
let currentSeg = null;

// Cronologia
const actionLog = [];
let nextLogId = 1;

// Tooltip state
let hovered = null;

let intervalId = null;

const COLORS = {
  pausa: "#ef4444",
  lavoro: "#f59e0b",
  studio: "#22c55e"
};
dotPausa.style.backgroundColor = COLORS.pausa;
dotLavoro.style.backgroundColor = COLORS.lavoro;
dotStudio.style.backgroundColor = COLORS.studio;


// Utils
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return (h > 0) ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function pct(part, total) {
  if (total <= 0) return 0;
  return Math.round((100 * part) / total);
}

function dateTimeLabel(date) {
  // giorno + data + ora, es: ven 27/02, 17:18
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function sessionMsNow(now) {
  return running && runStartMs !== null
    ? (sessionElapsedMs + (now - runStartMs))
    : sessionElapsedMs;
}

function ensureInterval() {
  if (intervalId !== null) return;
  intervalId = setInterval(tick, 250);
}

function stopInterval() {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function setPressedAction(state) {
  actionButtons.forEach(btn => {
    btn.setAttribute("aria-pressed", btn.dataset.state === state ? "true" : "false");
  });
}

function updateActiveDots() {
  rowPausa.classList.toggle("isActive", running && currentState === "pausa");
  rowLavoro.classList.toggle("isActive", running && currentState === "lavoro");
  rowStudio.classList.toggle("isActive", running && currentState === "studio");
}

function computeSegDur(seg, nowS) {
  const end = (seg.endS === null) ? nowS : seg.endS;
  return Math.max(0, end - seg.startS);
}

// Timeline segments
function addSegment(color, startS, state) {
  const segEl = document.createElement("div");
  segEl.className = "seg";
  segEl.style.backgroundColor = color;
  actualBar.style.backgroundColor = color;

  const textEl = document.createElement("div");
  textEl.className = "segText";
  textEl.textContent = "0:00";
  segEl.appendChild(textEl);

  timeline.appendChild(segEl);

  const segObj = {
    startS, endS: null, el: segEl, textEl,
    state, color,
    tipText: "",
    isTextHidden: false
  };

  segments.push(segObj);
  currentSeg = segObj;

  const idx = segments.length - 1;
  attachTooltipEvents(segObj, idx);

  return segObj;
}

// --- Render cronologia + refactor ---

function renderActionLogItem(entry) {
  const li = document.createElement("li");
  li.className = "logItem";
  li.dataset.id = String(entry.id);

  const head = document.createElement("div");
  head.className = "logHead";

  const chip = document.createElement("div");
  chip.className = "chip";

  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.backgroundColor = entry.color;

  const name = document.createElement("span");
  name.className = "logName";
  name.textContent = entry.state;

  chip.appendChild(dot);
  chip.appendChild(name);

  const time = document.createElement("div");
  time.className = "logTime";
  time.textContent = formatElapsed(entry.durationMs);

  head.appendChild(chip);
  head.appendChild(time);

  const note = document.createElement("textarea");
  note.className = "note";
  note.placeholder = "Aggiungi una nota per questa azione...";
  note.value = entry.note || "";

  note.addEventListener("input", () => {
    entry.note = note.value;
  });

  li.appendChild(head);
  li.appendChild(note);

  logEl.prepend(li);
}

function renderEventLogItem(entry) {
  const li = document.createElement("li");
  li.className = "logItem";
  li.dataset.id = String(entry.id);

  const head = document.createElement("div");
  head.className = "logHead";

  const badge = document.createElement("div");
  badge.className = "eventBadge";
  badge.textContent = entry.type;

  const small = document.createElement("small");
  small.textContent = `sessione ${entry.sessionN}`;

  badge.appendChild(document.createTextNode(" "));
  badge.appendChild(small);

  const time = document.createElement("div");
  time.className = "logTime";
  time.textContent = dateTimeLabel(entry.time);

  head.appendChild(badge);
  head.appendChild(time);

  li.appendChild(head);

  logEl.prepend(li);
}

// Cronologia items
function addActionItemInverse(state, color, durationMs) {
  const id = nextLogId++;
  const entry = { id, kind: "action", state, color, durationMs, note: "" };
  actionLog.push(entry);
  renderActionLogItem(entry);
}

function addEventItemInverse(type, dateObj, sessionN) {
  // type: "AVVIO" | "STOP"
  const id = nextLogId++;
  const entry = { id, kind: "event", type, time: dateObj, sessionN };
  actionLog.push(entry);
  renderEventLogItem(entry);
}

// Tooltip global
function showTooltip(text, targetEl) {
  tooltip.textContent = text;
  tooltip.dataset.show = "true";
  tooltipArrow.dataset.show = "true";
  positionTooltip(targetEl);
}

function hideTooltip() {
  hovered = null;
  tooltip.dataset.show = "false";
  tooltipArrow.dataset.show = "false";
}

function positionTooltip(targetEl) {
  const r = targetEl.getBoundingClientRect();
  const centerX = r.left + r.width / 2;
  const topY = r.top;

  tooltip.style.left = centerX + "px";
  tooltip.style.top = topY + "px";

  tooltipArrow.style.left = centerX + "px";
  tooltipArrow.style.top = topY + "px";
}

function buildSingleTip(seg, durMs, totalSessionMs) {
  return `nome: ${seg.state}\n` +
         `tempo: ${formatElapsed(durMs)}\n` +
         `percentuale: ${pct(durMs, totalSessionMs)}%`;
}

function buildClusterTip(clusterAgg, totalSessionMs) {
  const p = clusterAgg.pausa;
  const l = clusterAgg.lavoro;
  const s = clusterAgg.studio;

  return `pausa: ${formatElapsed(p)} (${pct(p, totalSessionMs)}%)\n` +
         `lavoro: ${formatElapsed(l)} (${pct(l, totalSessionMs)}%)\n` +
         `studio: ${formatElapsed(s)} (${pct(s, totalSessionMs)}%)`;
}

function findClusterBounds(index) {
  let start = index;
  let end = index;

  while (start - 1 >= 0 && segments[start - 1].isTextHidden) start--;
  while (end + 1 < segments.length && segments[end + 1].isTextHidden) end++;

  return { start, end };
}

function aggregateCluster(start, end, nowS) {
  const agg = { pausa: 0, lavoro: 0, studio: 0 };
  for (let i = start; i <= end; i++) {
    const seg = segments[i];
    const dur = computeSegDur(seg, nowS);
    agg[seg.state] += dur;
  }
  return agg;
}

function attachTooltipEvents(segObj, idx) {
  segObj.el.addEventListener("mouseenter", () => {
    if (segments[idx].isTextHidden) {
      const { start, end } = findClusterBounds(idx);
      hovered = { kind: "cluster", anchorIndex: idx, clusterStart: start, clusterEnd: end };
    } else {
      hovered = { kind: "single", segIndex: idx };
    }
    tick();
  });

  segObj.el.addEventListener("mouseleave", hideTooltip);
  segObj.el.addEventListener("mousemove", () => {
    if (!hovered) return;
    positionTooltip(segObj.el);
  });
}

// --- Export / Import JSON ---

function buildExportPayload() {
  const now = Date.now();
  const snapshotSessionMs = sessionMsNow(now);

  // copia dei totali, includendo il pezzo corrente se attivo
  const snapshotTotals = {
    pausa: totalsMs.pausa,
    lavoro: totalsMs.lavoro,
    studio: totalsMs.studio
  };

  let extraCurrentMs = 0;
  if (running && currentState && stateStartMs !== null) {
    extraCurrentMs = now - stateStartMs;
    if (snapshotTotals[currentState] != null) {
      snapshotTotals[currentState] += extraCurrentMs;
    }
  }

  // snapshot dei segmenti (chiudiamo eventuale segmento aperto al momento dell'export)
  const snapshotSegments = segments.map(seg => {
    const endS = seg.endS === null ? snapshotSessionMs : seg.endS;
    return {
      startS: seg.startS,
      endS,
      state: seg.state,
      color: seg.color
    };
  });

  // snapshot dell'actionLog + eventuale ultima azione corrente
  const snapshotActionLog = actionLog.map(entry => ({ ...entry }));

  if (extraCurrentMs > 0 && currentState) {
    snapshotActionLog.push({
      id: null,
      kind: "action",
      state: currentState,
      color: lastActionColor || COLORS[currentState] || "#999999",
      durationMs: extraCurrentMs,
      note: ""
    });
  }

  return {
  version: 2,
  exportedAt: new Date(now).toISOString(),
  sessionIndex,
  sessionElapsedMs: snapshotSessionMs,
  totalsMs: snapshotTotals,
  segments: snapshotSegments,
  actionLog: snapshotActionLog.map(entry => {
    if (entry.kind === "event") {
      return {
        ...entry,
        time: entry.time instanceof Date ? entry.time.toISOString() : entry.time
      };
    }
    return { ...entry };
  }),
  // AGGIUNGI QUESTE DUE RIGHE
  lastActionState,
  lastActionColor
};
}

function downloadJson(filename, dataObj) {
  const json = JSON.stringify(dataObj, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

function applyImportedHistory(data) {
  if (!data || typeof data !== "object") {
    alert("Struttura JSON non valida.");
    return;
  }

  if (!Array.isArray(data.actionLog)) {
    alert("Il JSON non contiene un array actionLog valido.");
    return;
  }

  // ferma tutto prima di importare
  running = false;
  stopInterval();
  hideTooltip();

  // reset stato temporale e grafico
  sessionElapsedMs = 0;
  runStartMs = null;

  currentState = null;
  stateStartMs = null;
  currentSeg = null;

  totalsMs.pausa = 0;
  totalsMs.lavoro = 0;
  totalsMs.studio = 0;

  segments.length = 0;
  timeline.innerHTML = "";

  // reset cronologia
  actionLog.length = 0;
  nextLogId = 1;
  logEl.innerHTML = "";

  // sessione importata (vecchia) + nuova sessione
  const importedSessionIndex =
    typeof data.sessionIndex === "number" && data.sessionIndex >= 1
      ? data.sessionIndex
      : 1;

  // mostriamo subito la NUOVA sessione dopo l'import
  sessionIndex = importedSessionIndex + 1;
  sessionTitle.textContent = `Sessione: ${sessionIndex}`;

  // ripristina tempo sessione (snapshot, per la parte importata)
  if (typeof data.sessionElapsedMs === "number" && data.sessionElapsedMs >= 0) {
    sessionElapsedMs = data.sessionElapsedMs;
  } else {
    sessionElapsedMs = 0;
  }

  // ripristina totalsMs se presenti
  if (data.totalsMs && typeof data.totalsMs === "object") {
    totalsMs.pausa = typeof data.totalsMs.pausa === "number" ? data.totalsMs.pausa : 0;
    totalsMs.lavoro = typeof data.totalsMs.lavoro === "number" ? data.totalsMs.lavoro : 0;
    totalsMs.studio = typeof data.totalsMs.studio === "number" ? data.totalsMs.studio : 0;
  }

  // ricostruisci i segmenti sulla barra, se presenti
  if (Array.isArray(data.segments)) {
    data.segments.forEach(segData => {
      const startS = typeof segData.startS === "number" ? segData.startS : 0;
      const color = segData.color || COLORS[segData.state] || "#999999";
      const state = segData.state || "pausa";

      const seg = addSegment(color, startS, state);
      seg.endS = typeof segData.endS === "number" ? segData.endS : null;

      // imposta il testo visibile nel segmento in base alla durata importata
      const nowS = sessionElapsedMs;
      const dur = computeSegDur(seg, nowS);
      seg.textEl.textContent = formatElapsed(dur);
    });

    // dopo aver ricreato tutti i segmenti non ce n'è uno "corrente"
    currentSeg = null;
  }

  // ricostruzione cronologia (manteniamo l'ordine originale)
  const entries = data.actionLog.map(raw => {
    const base = { ...raw };
    if (base.kind === "event" && typeof base.time === "string") {
      base.time = new Date(base.time);
    }
    return base;
  });

  for (const entry of entries) {
    if (entry.kind === "action") {
      const durationMs = typeof entry.durationMs === "number" ? entry.durationMs : 0;
      const color = entry.color || COLORS[entry.state] || "#999999";
      const id = nextLogId++;
      const normalized = {
        id,
        kind: "action",
        state: entry.state,
        color,
        durationMs,
        note: entry.note || ""
      };
      actionLog.push(normalized);
      renderActionLogItem(normalized);
    } else if (entry.kind === "event") {
      const id = nextLogId++;
      const normalized = {
        id,
        kind: "event",
        type: entry.type,
        time: entry.time instanceof Date ? entry.time : new Date(),
        sessionN: entry.sessionN || importedSessionIndex
      };
      actionLog.push(normalized);
      renderEventLogItem(normalized);
    }
  }

  // imposta lastActionState/Color in base ALL'ULTIMA ACTION importata
  const lastActionEntry = [...entries].reverse().find(e => e.kind === "action");
  if (lastActionEntry) {
    lastActionState = lastActionEntry.state;
    lastActionColor =
      lastActionEntry.color || COLORS[lastActionEntry.state] || "#999999";
  } else {
    lastActionState = null;
    lastActionColor = null;
  }

  // ridisegna tutto: tempo sessione, percentuali, barra ecc. (in stato fermo)
  tick();
}


// Core
function finalizeCurrentAction(now) {
  if (!currentState || stateStartMs === null) return;

  const durMs = now - stateStartMs;
  totalsMs[currentState] += durMs;

  const endS = sessionMsNow(now);
  if (currentSeg) currentSeg.endS = endS;

  addActionItemInverse(currentState, lastActionColor || "#ffffff", durMs);

  currentState = null;
  stateStartMs = null;
  currentSeg = null;

  setPressedAction(null);
  currentStateLabel.textContent = "—";
}

function startAction(nextState, color) {
  if (!running) return;
  if (nextState === currentState) return;

  const now = Date.now();

  if (currentState) finalizeCurrentAction(now);

  currentState = nextState;
  stateStartMs = now;

  lastActionState = nextState;
  lastActionColor = color;

  addSegment(color, sessionMsNow(now), nextState);

  setPressedAction(currentState);
  currentStateLabel.textContent = nextState;

  ensureInterval();
  tick();
}

function setRunning(nextRunning) {
  if (nextRunning === running) return;

  const now = Date.now();

  if (nextRunning) {
    // PLAY
    running = true;
    runStartMs = now;

    toggleBtn.textContent = "Stop";
    toggleBtn.setAttribute("aria-pressed", "true");

    addEventItemInverse("AVVIO", new Date(now), sessionIndex);

    ensureInterval();
    tick();

    // resume ultima azione
    if (!currentState && lastActionState && lastActionColor) {
      startAction(lastActionState, lastActionColor);
    } else if (!currentState) {
      currentStateLabel.textContent = "—";
    }
    return;
  }

  // STOP
  sessionElapsedMs = sessionMsNow(now);
  running = false;
  runStartMs = null;

  // chiudi azione corrente (log action)
  finalizeCurrentAction(now);

  addEventItemInverse("STOP", new Date(now), sessionIndex);

  tick();
  stopInterval();

  // incrementa sessione
  sessionIndex += 1;
  sessionTitle.textContent = `Sessione: ${sessionIndex}`;

  toggleBtn.textContent = "Play";
  toggleBtn.setAttribute("aria-pressed", "false");
}

function updateFlexAndVisibility(totalS, nowS) {
  const total = Math.max(1, totalS);

  segments.forEach(seg => {
    const dur = computeSegDur(seg, nowS);

    seg.el.style.flexGrow = String(dur);
    seg.el.style.flexBasis = "0px";

    const widthPct = (dur / total) * 100;
    const shouldHide = widthPct < HIDE_TEXT_UNDER_PCT;
    seg.isTextHidden = shouldHide;
    seg.textEl.classList.toggle("isHidden", shouldHide);
  });
}

function tick() {
  const now = Date.now();
  const nowS = sessionMsNow(now);

  elSessionTime.textContent = formatElapsed(nowS);

  if (running && currentState && stateStartMs !== null && currentSeg) {
    currentSeg.textEl.textContent = formatElapsed(now - stateStartMs);
  }

  ["pausa","lavoro","studio"].forEach(st => {
    const base = totalsMs[st];
    const extra = (running && st === currentState && stateStartMs !== null) ? (now - stateStartMs) : 0;
    const ms = base + extra;
    statEls[st].textContent = `${formatElapsed(ms)} (${pct(ms, nowS)}%)`;
  });

  updateFlexAndVisibility(nowS, nowS);

  const totalSessionMs = Math.max(1, nowS);
  segments.forEach(seg => {
    const dur = computeSegDur(seg, nowS);
    seg.tipText = buildSingleTip(seg, dur, totalSessionMs);
  });

  if (hovered) {
    if (hovered.kind === "single") {
      const seg = segments[hovered.segIndex];
      if (seg && !seg.isTextHidden) {
        showTooltip(seg.tipText, seg.el);
      } else if (seg) {
        const { start, end } = findClusterBounds(hovered.segIndex);
        hovered = { kind: "cluster", anchorIndex: hovered.segIndex, clusterStart: start, clusterEnd: end };
        const agg = aggregateCluster(start, end, nowS);
        showTooltip(buildClusterTip(agg, totalSessionMs), segments[hovered.anchorIndex].el);
      } else {
        hideTooltip();
      }
    } else {
      const { start, end } = findClusterBounds(hovered.anchorIndex);
      hovered.clusterStart = start;
      hovered.clusterEnd = end;

      const agg = aggregateCluster(start, end, nowS);
      showTooltip(buildClusterTip(agg, totalSessionMs), segments[hovered.anchorIndex].el);
    }
  }

  updateActiveDots();
}

// Events
actionButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    if (!running) setRunning(true);
    startAction(btn.dataset.state, btn.dataset.color);
  });
});

toggleBtn.addEventListener("click", () => {
  const pressed = toggleBtn.getAttribute("aria-pressed") === "true";
  setRunning(!pressed);
  hideTooltip();
});

resetBtn.addEventListener("click", () => {
  hideTooltip();

  running = false;
  sessionElapsedMs = 0;
  runStartMs = null;

  currentState = null;
  stateStartMs = null;
  currentSeg = null;

  totalsMs.pausa = totalsMs.lavoro = totalsMs.studio = 0;
  segments.length = 0;

  lastActionState = null;
  lastActionColor = null;

  stopInterval();

  timeline.innerHTML = "";
  logEl.innerHTML = "";

  actionLog.length = 0;
  nextLogId = 1;

  elSessionTime.textContent = "0:00";
  statEls.pausa.textContent = "0:00 (0%)";
  statEls.lavoro.textContent = "0:00 (0%)";
  statEls.studio.textContent = "0:00 (0%)";

  setPressedAction(null);
  currentStateLabel.textContent = "—";

  sessionIndex = 1;
  sessionTitle.textContent = `Sessione: 1`;

  toggleBtn.textContent = "Play";
  toggleBtn.setAttribute("aria-pressed", "false");

  updateActiveDots();
  tick();
});

// Eventi export/import JSON
exportJsonBtn.addEventListener("click", () => {
  if (actionLog.length === 0) {
    alert("Nessuna cronologia da esportare.");
    return;
  }
  const payload = buildExportPayload();
  const filename = `session-log-${payload.sessionIndex}.json`;
  downloadJson(filename, payload);
});

importJsonBtn.addEventListener("click", () => {
  importJsonInput.value = "";
  importJsonInput.click();
});

importJsonInput.addEventListener("change", () => {
  const file = importJsonInput.files && importJsonInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "");
      const data = JSON.parse(text);
      applyImportedHistory(data);
    } catch (err) {
      console.error(err);
      alert("File JSON non valido.");
    }
  };
  reader.readAsText(file, "utf-8");
});

window.addEventListener("resize", () => { if (hovered) tick(); });
window.addEventListener("scroll", () => { if (hovered) tick(); }, { passive: true });

tick();
