// devTimer.js: an offline darkroom development timer. Picks a datasheet recipe,
// walks the chemical steps with countdowns and an agitation metronome (visual +
// audio + haptic), and logs a process.developSession through the outbox so it
// works with no signal. Timing is scheduled on absolute wall-clock timestamps, so
// backgrounding, screen-lock, or a refresh never causes drift — and an in-progress
// run is mirrored to localStorage for crash/refresh recovery.

import { el, $, toast } from "./dom.js";
import { NS, saveRecord, instanceLabel } from "../graycard.js";
import { icon } from "./icons.js";
import * as outbox from "../outbox.js";
import { searchFilms, recipesForFilm, recipeLabel, resolveTimeSec, publishedTemps, c10ToC, cToC10, fmtMMSS, parseMMSS } from "../devRecipes.js";

const MIRROR = (did) => `hypo:devtimer:${did || "anon"}`;

// default following steps (after the datasheet develop step) per process. Times
// are editable defaults, not datasheet claims.
function defaultChain(process, developStep) {
  const wash = { name: "Wash", role: "wash", seconds: 300 };
  if (process === "monobath") return [developStep, { name: "Wash", role: "wash", seconds: 300 }];
  if (process === "c41") return [developStep, { name: "Blix", role: "blix", seconds: 390 }, wash, { name: "Stabilizer", role: "stabilizer", seconds: 60 }];
  if (process === "e6") return [developStep, { name: "Wash", role: "wash", seconds: 120 }, { name: "Colour developer", role: "color-developer", seconds: 360 }, { name: "Blix", role: "blix", seconds: 360 }, wash];
  // b&w (and reversal-bw first pass)
  return [developStep, { name: "Stop bath", role: "stop", seconds: 30 }, { name: "Fixer", role: "fixer", seconds: 300 }, wash];
}

export function activeDevRun(did) {
  try { return JSON.parse(localStorage.getItem(MIRROR(did)) || "null"); } catch { return null; }
}
function saveMirror(did, state) {
  try { localStorage.setItem(MIRROR(did), JSON.stringify(state)); } catch { /* best effort */ }
}
function clearMirror(did) {
  try { localStorage.removeItem(MIRROR(did)); } catch { /* ignore */ }
}

// -- a tiny audio + haptic cue engine (unlocked on the first user gesture) -----
function makeCues() {
  let ac = null;
  const ensure = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } } return ac; };
  const beep = (freq = 880, ms = 120, gain = 0.15) => {
    const ctx = ensure(); if (!ctx) return;
    try {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.type = "sine";
      g.gain.value = gain; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + ms / 1000);
    } catch { /* ignore */ }
  };
  const vibrate = (p) => { try { navigator.vibrate?.(p); } catch { /* ignore */ } };
  return {
    unlock: ensure,
    agitate: () => { beep(660, 90); vibrate(60); },
    stepEnd: () => { beep(520, 180, 0.2); setTimeout(() => beep(700, 220, 0.2), 220); vibrate([120, 80, 120]); },
    done: () => { beep(784, 200, 0.2); setTimeout(() => beep(988, 260, 0.2), 240); vibrate([150, 80, 150, 80, 200]); },
  };
}

export function openDevTimer(ctx, opts = {}) {
  const cues = makeCues();
  let wakeLock = null;
  const overlay = el("div", { class: "logger-overlay devtimer", role: "dialog", "aria-modal": "true", "aria-label": "Development timer" });
  const body = el("div", { class: "devtimer-body" });
  overlay.append(body);
  document.body.append(overlay);
  document.body.style.overflow = "hidden";

  const requestWake = async () => { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; } };
  const releaseWake = () => { try { wakeLock?.release?.(); } catch { /* ignore */ } wakeLock = null; };
  const close = () => { releaseWake(); document.body.style.overflow = ""; overlay.remove(); clearInterval(run.timer); opts.onDone?.(); };

  const run = { timer: null };

  // resume an in-progress run if one is mirrored
  const existing = activeDevRun(ctx.did);
  if (existing && opts.allowResume !== false) startRun(existing, true);
  else renderSetup();

  // -- setup phase -----------------------------------------------------------
  function renderSetup() {
    const sel = { film: null, recipe: null, tempC10: null, steps: null, manualDevSec: null };
    body.replaceChildren();
    const head = el("div", { class: "logger-top row between" }, [
      el("strong", {}, "Start development"),
      el("button", { class: "ghost small-btn", onclick: close }, "Cancel"),
    ]);
    const stage = el("div", { class: "devtimer-setup" });
    body.append(head, stage);

    const filmSearch = el("input", { type: "search", class: "search-input", placeholder: "Search film (e.g. Tri-X, HP5, Portra)…" });
    const filmList = el("div", { class: "devtimer-list" });
    const renderFilms = () => {
      filmList.replaceChildren(...searchFilms(filmSearch.value, 30).map((f) =>
        el("button", { class: "devtimer-opt" + (sel.film && sel.film.key === f.key ? " on" : ""), onclick: () => { sel.film = f; sel.recipe = null; renderStage(); } },
          [el("span", {}, `${f.make} ${f.name}`), el("span", { class: "muted small" }, `${f.count} recipe${f.count === 1 ? "" : "s"}`)])));
    };
    filmSearch.addEventListener("input", renderFilms);

    function renderStage() {
      stage.replaceChildren();
      stage.append(el("label", { class: "field" }, [el("span", {}, "Film"), filmSearch]), filmList);
      renderFilms();
      if (!sel.film) return;

      // recipe options for this film
      const recipes = recipesForFilm(sel.film.make, sel.film.name);
      const recWrap = el("div", { class: "devtimer-list" });
      for (const r of recipes) {
        const temps = publishedTemps(r).map((t) => `${c10ToC(t)}°`).join(", ");
        recWrap.append(el("button", { class: "devtimer-opt" + (sel.recipe === r ? " on" : ""), onclick: () => { sel.recipe = r; sel.tempC10 = defaultTemp(r); sel.manualDevSec = null; renderStage(); } },
          [el("span", {}, recipeLabel(r)), el("span", { class: "muted small" }, `${r.process.toUpperCase()} · ${temps}`)]));
      }
      stage.append(el("h4", { class: "stat-h" }, "Recipe"), recWrap);
      if (!sel.recipe) return;

      // temperature + resolved develop time
      const r = sel.recipe;
      const tempIn = el("input", { type: "number", step: "0.1", class: "date-input", value: String(c10ToC(sel.tempC10)) });
      const devLine = el("div", { class: "devtimer-devtime" });
      const manualWrap = el("div");
      const manualIn = el("input", { type: "text", class: "date-input", placeholder: "m:ss (e.g. 6:45)" });
      // optional: link the physical chemistry bottle so its rolls-processed count
      // climbs as you develop (drives the Chemistry status card in Insights).
      const chems = ctx.store?.instance?.chemistry || [];
      const chemSel = el("select", { class: "date-input" }, [el("option", { value: "" }, "(none — don't track)"), ...chems.map((c) => el("option", { value: c.uri }, instanceLabel("chemistry", c.value, ctx.store)))]);
      const startBtn = el("button", { class: "log-btn", disabled: true }, "Start development");

      const recompute = () => {
        sel.tempC10 = cToC10(parseFloat(tempIn.value) || 20);
        const datasheet = resolveTimeSec(r, sel.tempC10);
        manualWrap.replaceChildren();
        if (datasheet != null) {
          sel.manualDevSec = datasheet;
          devLine.className = "devtimer-devtime ok";
          devLine.textContent = `Develop ${fmtMMSS(datasheet)} at ${c10ToC(sel.tempC10)}°C (datasheet)`;
          startBtn.disabled = false;
        } else {
          const range = publishedTemps(r).map((t) => `${c10ToC(t)}°`).join(", ");
          devLine.className = "devtimer-devtime warn";
          devLine.textContent = `No datasheet time at ${c10ToC(sel.tempC10)}°C. Datasheet covers: ${range}. Enter your own time:`;
          manualWrap.append(el("label", { class: "field" }, [el("span", {}, "Your develop time"), manualIn]));
          const parsed = parseMMSS(manualIn.value);
          sel.manualDevSec = parsed;
          startBtn.disabled = parsed == null;
        }
      };
      tempIn.addEventListener("input", recompute);
      manualIn.addEventListener("input", () => { sel.manualDevSec = parseMMSS(manualIn.value); startBtn.disabled = sel.manualDevSec == null; });

      startBtn.addEventListener("click", () => {
        cues.unlock();
        const developStep = { name: "Develop", role: "developer", seconds: sel.manualDevSec, agitation: r.agitation || null };
        const steps = defaultChain(r.process, developStep).map((s) => ({ ...s, actualSec: null }));
        const state = {
          film: `${sel.film.make} ${sel.film.name}`,
          developer: recipeLabel(r),
          dilution: r.dilution || null,
          process: r.process,
          tempC10: sel.tempC10,
          source: r.source,
          chemistry: chemSel.value || null,
          rolls: opts.rolls || [],
          steps, index: 0, running: false, endsAt: null, remaining: steps[0].seconds,
          startedAt: new Date().toISOString(),
        };
        startRun(state, false);
      });

      stage.append(
        el("h4", { class: "stat-h" }, "Temperature"),
        el("div", { class: "row", style: "gap:10px;align-items:center" }, [tempIn, el("span", { class: "muted small" }, "°C")]),
        devLine, manualWrap,
        chems.length ? el("label", { class: "field" }, [el("span", {}, "Chemistry (optional — tracks usage)"), chemSel]) : null,
        el("p", { class: "muted small" }, "Following steps (stop / fix / wash) are editable defaults, not datasheet times."),
        startBtn,
      );
      recompute();
    }
    renderStage();
  }

  // -- run phase -------------------------------------------------------------
  function startRun(state, resumed) {
    requestWake();
    let lastAgIndexCue = -1;

    const bigTime = el("div", { class: "devtimer-time" }, "0:00");
    const stepName = el("div", { class: "devtimer-step" });
    const stepMeta = el("div", { class: "muted small" });
    const bar = el("div", { class: "devtimer-bar" }, [el("div", { class: "devtimer-fill" })]);
    const agBanner = el("div", { class: "devtimer-agitate" }, "Agitate");
    const primary = el("button", { class: "log-btn" });
    const nudgeMinus = el("button", { class: "log-btn secondary", onclick: () => nudge(-15) }, "−15s");
    const nudgePlus = el("button", { class: "log-btn secondary", onclick: () => nudge(15) }, "+15s");
    const skip = el("button", { class: "log-btn secondary", onclick: () => completeStep(true) }, "Step done ›");
    const finishBtn = el("button", { class: "ghost small-btn", onclick: () => finish() }, "Finish & log");
    const cancelBtn = el("button", { class: "ghost small-btn", onclick: () => { if (confirm("Discard this development run?")) { clearMirror(ctx.did); close(); } } }, "Discard");

    const fill = () => bar.querySelector(".devtimer-fill");
    const curStep = () => state.steps[state.index];

    function render() {
      const s = curStep();
      stepName.textContent = s ? s.name : "Done";
      stepMeta.textContent = s ? `Step ${state.index + 1} of ${state.steps.length}${s.role === "developer" ? ` · ${state.developer} · ${c10ToC(state.tempC10)}°C` : ""}` : "All steps complete";
      primary.textContent = state.running ? "Pause" : (state.remaining === s?.seconds ? "Start step" : "Resume");
      const total = s ? s.seconds : 1;
      const rem = state.remaining;
      bigTime.textContent = fmtMMSS(rem);
      fill().style.width = `${Math.max(0, Math.min(100, (1 - rem / total) * 100))}%`;
      body.dataset.developing = state.running ? "1" : "0";
    }

    function persist() { saveMirror(ctx.did, state); }

    function tick() {
      if (!state.running || state.endsAt == null) return;
      const rem = (state.endsAt - Date.now()) / 1000;
      state.remaining = Math.max(0, rem);
      // agitation cueing during the develop step
      const s = curStep();
      if (s?.agitation && (s.agitation.everySec || s.agitation.initialSec)) {
        const elapsed = s.seconds - state.remaining;
        const ag = s.agitation;
        let active = false, cueIdx = -1;
        if (ag.initialSec && elapsed <= ag.initialSec) { active = true; cueIdx = 0; }
        else if (ag.everySec) {
          const since = elapsed - (ag.initialSec || 0);
          const inCycle = ((since % ag.everySec) + ag.everySec) % ag.everySec;
          if (inCycle < (ag.forSec || 5)) { active = true; cueIdx = Math.floor(since / ag.everySec) + 1; }
        }
        agBanner.classList.toggle("on", active && state.remaining > 0);
        if (active && cueIdx !== lastAgIndexCue) { cues.agitate(); lastAgIndexCue = cueIdx; }
      } else {
        agBanner.classList.remove("on");
      }
      if (state.remaining <= 0) { completeStep(false); return; }
      render();
    }

    function startOrPause() {
      const s = curStep(); if (!s) return;
      if (state.running) { state.remaining = Math.max(0, (state.endsAt - Date.now()) / 1000); state.running = false; state.endsAt = null; }
      else { state.running = true; state.endsAt = Date.now() + state.remaining * 1000; lastAgIndexCue = -1; }
      persist(); render();
    }
    function nudge(delta) {
      state.remaining = Math.max(0, state.remaining + delta);
      if (state.running) state.endsAt = Date.now() + state.remaining * 1000;
      persist(); render();
    }
    function completeStep(manual) {
      const s = curStep(); if (!s) return;
      s.actualSec = Math.round(s.seconds - (manual ? state.remaining : 0));
      if (!manual) cues.stepEnd();
      state.index += 1; state.running = false; state.endsAt = null;
      if (state.index >= state.steps.length) { cues.done(); persist(); render(); primary.disabled = true; toast("Development complete — tap Finish & log", "ok", 5000); return; }
      state.remaining = state.steps[state.index].seconds; lastAgIndexCue = -1;
      persist(); render();
    }
    async function finish() {
      // mark current step actual if mid-run
      const s = curStep();
      if (s && s.actualSec == null) s.actualSec = Math.round(s.seconds - state.remaining);
      const dev = state.steps[0];
      const rec = {
        process: state.process,                 // faithful (bw / monobath / c41 / …)
        temperature: { unit: "celsius", value: state.tempC10, scale: 10 },
        timeSeconds: dev.actualSec ?? dev.seconds,
        dilution: state.dilution || undefined,
        chemistry: state.chemistry || undefined,
        tankType: "tank",
        agitation: dev.agitation?.note || undefined,
        filmRolls: state.rolls?.length ? state.rolls : undefined,
        startedAt: state.startedAt,
        finishedAt: new Date().toISOString(),
        notes: `${state.film} in ${state.developer}${state.dilution && state.dilution !== "stock" ? ` ${state.dilution}` : ""} at ${c10ToC(state.tempC10)}°C. Steps: ${state.steps.map((x) => `${x.name} ${fmtMMSS(x.actualSec ?? x.seconds)}`).join(", ")}. Logged via timer (source: ${state.source}).`,
        provenance: { source: "manual", assertedAt: new Date().toISOString() },
        createdAt: new Date().toISOString(),
      };
      outbox.enqueue(ctx.did, NS.process.developSession, rec);
      // bump the linked chemistry's usage so its capacity/age card reflects reality
      // (best-effort, online — a putRecord isn't offline-queued).
      if (state.chemistry) {
        const c = (ctx.store?.instance?.chemistry || []).find((x) => x.uri === state.chemistry);
        if (c) {
          const n = Math.max(1, state.rolls?.length || 1);
          saveRecord(ctx.agent, ctx.did, NS.instance.chemistry,
            { ...c.value, rollsProcessed: (c.value.rollsProcessed || 0) + n, sessionsUsed: (c.value.sessionsUsed || 0) + 1, updatedAt: new Date().toISOString() }, c)
            .catch(() => {});
        }
      }
      clearMirror(ctx.did);
      toast(outbox.isOnline() ? "Development logged ✓" : "Logged offline — will sync", outbox.isOnline() ? "ok" : "info", 2600);
      outbox.flush(ctx.agent, ctx.did).catch(() => {});
      close();
    }

    primary.addEventListener("click", startOrPause);

    body.replaceChildren(
      el("div", { class: "logger-top row between" }, [el("strong", {}, state.film), cancelBtn]),
      el("div", { class: "devtimer-run" }, [
        stepName, stepMeta, agBanner, bigTime, bar,
        el("div", { class: "row devtimer-controls" }, [nudgeMinus, primary, nudgePlus]),
        el("div", { class: "row devtimer-controls" }, [skip, finishBtn]),
      ]),
    );
    // if resumed while running, re-anchor the countdown to wall-clock
    if (resumed && state.running && state.endsAt != null) { /* endsAt is absolute; tick recomputes */ }
    else if (resumed) { state.running = false; }
    render();
    run.timer = setInterval(tick, 250);
    if (resumed && state.running) toast("Resumed development in progress", "info", 2600);
  }
}

function defaultTemp(recipe) {
  const temps = publishedTemps(recipe);
  if (temps.includes(200)) return 200;                 // prefer 20°C when published
  return temps[0] ?? 200;
}
