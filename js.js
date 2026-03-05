
    const timeline = document.getElementById("timeline");
    const sessionTitle = document.getElementById("sessionTitle");
    const logEl = document.getElementById("log");
    const currentStateLabel = document.getElementById("currentStateLabel");

    const actionButtons = Array.from(document.querySelectorAll("button[data-state]"));
    const toggleBtn = document.getElementById("toggle");
    const resetBtn = document.getElementById("reset");

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

    const actualBar = document.getElementById ("actual-bar")

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
      // giorno + data + ora, es: ven 27/02, 17:18 [web:282][web:289]
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

    // Cronologia items
    function addActionItemInverse(state, color, durationMs) {
      const id = nextLogId++;
      const entry = { id, kind: "action", state, color, durationMs, note: "" };
      actionLog.push(entry);

      const li = document.createElement("li");
      li.className = "logItem";
      li.dataset.id = String(id);

      const head = document.createElement("div");
      head.className = "logHead";

      const chip = document.createElement("div");
      chip.className = "chip";

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.backgroundColor = color;

      const name = document.createElement("span");
      name.className = "logName";
      name.textContent = state;

      chip.appendChild(dot);
      chip.appendChild(name);

      const time = document.createElement("div");
      time.className = "logTime";
      time.textContent = formatElapsed(durationMs);

      head.appendChild(chip);
      head.appendChild(time);

      const note = document.createElement("textarea");
      note.className = "note";
      note.placeholder = "Aggiungi una nota per questa azione...";
      note.value = entry.note;

      note.addEventListener("input", () => {
        entry.note = note.value;
      });

      li.appendChild(head);
      li.appendChild(note);

      logEl.prepend(li);
    }

    function addEventItemInverse(type, dateObj, sessionN) {
      // type: "AVVIO" | "STOP"
      const id = nextLogId++;
      const entry = { id, kind: "event", type, time: dateObj, sessionN };
      actionLog.push(entry);

      const li = document.createElement("li");
      li.className = "logItem";
      li.dataset.id = String(id);

      const head = document.createElement("div");
      head.className = "logHead";

      const badge = document.createElement("div");
      badge.className = "eventBadge";
      badge.textContent = type;

      const small = document.createElement("small");
      small.textContent = `sessione ${sessionN}`;

      badge.appendChild(document.createTextNode(" "));
      badge.appendChild(small);

      const time = document.createElement("div");
      time.className = "logTime";
      time.textContent = dateTimeLabel(dateObj);

      head.appendChild(badge);
      head.appendChild(time);

      li.appendChild(head);

      logEl.prepend(li);
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

    window.addEventListener("resize", () => { if (hovered) tick(); });
    window.addEventListener("scroll", () => { if (hovered) tick(); }, { passive: true });

    tick();