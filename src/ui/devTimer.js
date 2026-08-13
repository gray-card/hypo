// devTimer.js: an offline darkroom development timer. Picks a datasheet recipe,
// walks the chemical steps with countdowns and an agitation metronome (visual +
// audio + haptic), and logs a process.developSession through the outbox so it
// works with no signal. Timing is scheduled on absolute wall-clock timestamps, so
// backgrounding, screen-lock, or a refresh never causes drift — and an in-progress
// run is mirrored to localStorage for crash/refresh recovery.

import { el, toast } from "./dom.js";
import { bindValueText } from "@hypo/ui";
import { NS, saveRecord, instanceLabel } from "../graycard.js";
import * as outbox from "../outbox.js";
import { repoClient } from "../pds.js";
import {
  searchFilms,
  recipesForFilm,
  recipeLabel,
  recipeRecommendationStatus,
  resolveTimeRecommendation,
  publishedTemps,
  c10ToC,
  cToC10,
  fmtMMSS,
  parseMMSS,
} from "../devRecipes.js";
import { activeDevRun, saveDevRun, clearDevRun } from "./devTimerState.js";
import {
  closestExposureRecipe,
  deriveExposureObservation,
  exposureSuggestionText,
  selectedVsObservedText,
} from "./devTimerExposure.js";
import "./shotLogger.css";

const recipeMeasure = (m) =>
  m && typeof m.value === "number" ? `${m.value / (m.scale || 1)} ${m.unit || ""}`.trim() : null;
const recipeAgitation = (ag) => {
  if (!ag) return null;
  const bits = [];
  if (ag.continuous) bits.push("continuous");
  if (ag.initialSec) bits.push(`first ${ag.initialSec}s`);
  if (ag.everySec) bits.push(`every ${ag.everySec}s${ag.forSec ? ` for ${ag.forSec}s` : ""}`);
  if (ag.inversions) bits.push(`${ag.inversions} inversions`);
  if (ag.note) bits.push(ag.note);
  return bits.join(" · ") || null;
};
const pushPullText = (r) => {
  const m = recipeMeasure(r.pushPull);
  if (m) return m;
  return r.ei ? `EI ${r.ei}` : null;
};
const sourceDocumentUrl = (doc) => doc?.asset?.url || null;
const recipeDocument = (r) =>
  r.sourceDocument ||
  (r.source
    ? {
        kind: "technical-data",
        asset: { url: r.source },
        publisher: r.developerMake || undefined,
        revision: r.sourceRevision || undefined,
      }
    : null);
function recipeUri(store, recipe) {
  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase();
  return (
    (store?.catalog?.devRecipe || []).find(
      ({ value: v }) =>
        norm(v.filmMake) === norm(recipe.filmMake) &&
        norm(v.filmName) === norm(recipe.filmName) &&
        norm(v.developerMake) === norm(recipe.developerMake) &&
        norm(v.developerName) === norm(recipe.developerName) &&
        norm(v.dilution) === norm(recipe.dilution) &&
        (v.ei || null) === (recipe.ei || null),
    )?.uri || null
  );
}
function recipeSourceSpec(r, document = recipeDocument(r), recommendation = null) {
  const spec = r.specSources?.[0]
    ? {
        ...r.specSources[0],
        page: r.specSources[0].page || r.sourcePage || undefined,
        table: r.specSources[0].table || r.sourceTable || undefined,
      }
    : document
      ? {
          document,
          fields: ["temps", "agitation", "tankType", "dilution"],
          page: r.sourcePage || undefined,
          table: r.sourceTable || undefined,
          method: r.derived ? "derived" : "manual-transcription",
        }
      : null;
  if (!spec) return null;
  if (r.derived !== true && recommendation?.kind !== "interpolated") return spec;
  const derivation =
    recommendation?.kind === "interpolated"
      ? `Time at ${c10ToC(recommendation.tempC10)}°C was interpolated from the published ${recommendation.points.map((p) => `${c10ToC(p.tempC10)}°C/${fmtMMSS(p.timeSec)}`).join(" and ")} points using ${recommendation.interpolationMethod}.`
      : r.derivationNotes;
  return {
    ...spec,
    method: "derived",
    note: [spec.note, derivation].filter(Boolean).join(" ") || undefined,
  };
}
export function recipeTechnicalDetails(r, recommendation = null) {
  const rows = [];
  const add = (label, value, node = null) => {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
    rows.push(el("dt", {}, label), el("dd", {}, node || String(value)));
  };
  add("Exposure index / push-pull", pushPullText(r));
  add("Dilution", r.dilution);
  add(
    "Published temperature/time points",
    (r.temps || []).map((p) => `${c10ToC(p.tempC10)}°C — ${fmtMMSS(p.timeSec)}`).join(", "),
  );
  add("Method", [r.tankType, r.rotaryRpm ? `${r.rotaryRpm} rpm` : null, r.methodNotes].filter(Boolean).join(" · "));
  add("Agitation", recipeAgitation(r.agitation));
  add("Contrast target", r.contrastTarget);
  add("Gamma target", recipeMeasure(r.gammaTarget));
  add("Recommendation", recommendation?.recommendationStatus || recipeRecommendationStatus(r));
  if (recommendation)
    add(
      "Selected time",
      recommendation.kind === "published"
        ? "Exact published row"
        : `Derived by ${recommendation.interpolationMethod} interpolation`,
    );
  const document = recipeDocument(r);
  const sourceUrl = r.source || sourceDocumentUrl(document);
  if (sourceUrl)
    add(
      "Source",
      sourceUrl,
      el("a", { href: sourceUrl, target: "_blank", rel: "noopener" }, document?.publisher || "Manufacturer document"),
    );
  add(
    "Document",
    [
      document?.documentNumber,
      r.sourceRevision || document?.revision,
      r.sourcePage ? `p. ${r.sourcePage}` : null,
      r.sourceTable ? `table ${r.sourceTable}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  if (r.interpolationAllowed === true) {
    add("Interpolation", `Allowed${r.interpolationMethod ? ` · ${r.interpolationMethod}` : ""}`);
  } else if (r.interpolationAllowed === false) add("Interpolation", "Not permitted by this recipe");
  else add("Interpolation", "Not specified; exact published points only");
  if (r.derived) add("Derived values", r.derivationNotes || "One or more values were calculated from the source.");
  return el("details", { class: "recipe-technical" }, [
    el("summary", {}, "Recipe details and source"),
    el("dl", { class: "technical-spec-list" }, rows),
  ]);
}

// default following steps (after the datasheet develop step) per process. Times
// are editable defaults, not datasheet claims.
function defaultChain(process, developStep) {
  const wash = { name: "Wash", roles: [], seconds: 300 };
  if (process === "monobath") return [developStep, { name: "Wash", roles: [], seconds: 300 }];
  if (process === "c41")
    return [
      developStep,
      { name: "Blix", roles: ["bleach", "fixer"], seconds: 390 },
      wash,
      { name: "Stabilizer", roles: ["stabilizer"], seconds: 60 },
    ];
  if (process === "e6")
    return [
      developStep,
      { name: "Wash", roles: [], seconds: 120 },
      { name: "Colour developer", roles: ["color-developer"], seconds: 360 },
      { name: "Blix", roles: ["bleach", "fixer"], seconds: 360 },
      wash,
    ];
  // b&w (and reversal-bw first pass)
  return [
    developStep,
    { name: "Stop bath", roles: ["stop"], seconds: 30 },
    { name: "Fixer", roles: ["fixer"], seconds: 300 },
    wash,
  ];
}

export { activeDevRun } from "./devTimerState.js";

// -- a tiny audio + haptic cue engine (unlocked on the first user gesture) -----
function makeCues(initiallyEnabled = true) {
  let ac = null;
  let enabled = initiallyEnabled;
  const ensure = () => {
    if (!enabled) return null;
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        ac = null;
      }
    }
    return ac;
  };
  const beep = (freq = 880, ms = 120, gain = 0.15) => {
    const ctx = ensure();
    if (!ctx) return;
    try {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.value = gain;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + ms / 1000);
    } catch {
      /* ignore */
    }
  };
  const vibrate = (p) => {
    if (!enabled) return;
    try {
      navigator.vibrate?.(p);
    } catch {
      /* ignore */
    }
  };
  return {
    unlock: ensure,
    setEnabled(next) {
      enabled = Boolean(next);
      if (enabled) ensure();
    },
    agitate: () => {
      beep(660, 90);
      vibrate(60);
    },
    stepEnd: () => {
      beep(520, 180, 0.2);
      setTimeout(() => beep(700, 220, 0.2), 220);
      vibrate([120, 80, 120]);
    },
    done: () => {
      beep(784, 200, 0.2);
      setTimeout(() => beep(988, 260, 0.2), 240);
      vibrate([150, 80, 150, 80, 200]);
    },
  };
}

export function openDevTimer(ctx, opts = {}) {
  let visualOnly = opts.visualOnly === true;
  const cues = makeCues(!visualOnly);
  let wakeLock = null;
  const overlay = el("div", {
    class: "logger-overlay devtimer",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Development timer",
  });
  const body = el("div", { class: "devtimer-body" });
  overlay.append(body);
  document.body.append(overlay);
  document.body.style.overflow = "hidden";

  let meterReadings = opts.meterReadings || ctx.store?.meterReadings || ctx.store?.meter?.reading || [];
  let refreshExposureEvidence = () => {};
  if (ctx.agent && ctx.did && opts.meterReadings === undefined) {
    repoClient(ctx.agent)
      .listAll({ repo: ctx.did, collection: NS.meter.reading, limit: 100 })
      .then((records) => {
        meterReadings = records.map((record) => ({ ...record, value: record.value || {} }));
        if (overlay.isConnected) refreshExposureEvidence();
      })
      .catch(() => {
        // Explicit roll/exposure ratings still produce a suggestion offline.
      });
  }

  const requestWake = async () => {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      wakeLock = null;
    }
  };
  const releaseWake = () => {
    try {
      wakeLock?.release?.();
    } catch {
      /* ignore */
    }
    wakeLock = null;
  };
  const close = () => {
    releaseWake();
    document.body.style.overflow = "";
    overlay.remove();
    clearInterval(run.timer);
    opts.onDone?.();
  };

  const run = { timer: null };

  // resume an in-progress run if one is mirrored
  const existing = activeDevRun(ctx.did);
  if (existing && opts.allowResume !== false) startRun(existing, true);
  else renderSetup();

  // -- setup phase -----------------------------------------------------------
  function renderSetup() {
    const sel = {
      film: null,
      recipe: null,
      tempC10: null,
      actualTempC10: null,
      steps: null,
      manualDevSec: null,
      publishedDevSec: null,
      recommendation: null,
      rolls: [...(opts.rolls || [])],
      observation: null,
    };
    body.replaceChildren();
    const head = el("div", { class: "logger-top row between" }, [
      el("strong", {}, "Start development"),
      el("button", { class: "ghost small-btn", onclick: close }, "Cancel"),
    ]);
    const stage = el("div", { class: "devtimer-setup" });
    body.append(head, stage);

    const filmSearch = el("input", {
      type: "search",
      class: "search-input",
      placeholder: "Search film (e.g. Tri-X, HP5, Portra)…",
    });
    const filmList = el("div", { class: "devtimer-list" });
    const availableRolls = (ctx.store?.instance?.filmRoll || []).filter((roll) => roll.value.status !== "archived");
    const rollSel = el("select", { class: "date-input", "aria-label": "Roll to develop" }, [
      el("option", { value: "" }, "No roll selected"),
      ...availableRolls.map((roll) =>
        el("option", { value: roll.uri }, instanceLabel("filmRoll", roll.value, ctx.store)),
      ),
    ]);
    rollSel.value = sel.rolls[0] || "";
    const stockForRoll = (uri) => {
      const roll = availableRolls.find((candidate) => candidate.uri === uri);
      return (ctx.store?.catalog?.filmStock || []).find((stock) => stock.uri === roll?.value.stock)?.value || null;
    };
    const filmForRoll = (uri) => {
      const stock = stockForRoll(uri);
      if (!stock) return null;
      const normalize = (text) =>
        String(text || "")
          .trim()
          .toLowerCase();
      return searchFilms(`${stock.brand || ""} ${stock.name || ""}`, 100).find(
        (film) => normalize(film.make) === normalize(stock.brand) && normalize(film.name) === normalize(stock.name),
      );
    };
    const updateObservation = () => {
      sel.observation = deriveExposureObservation({ store: ctx.store, rollUris: sel.rolls, meterReadings });
    };
    const selectRoll = (uri) => {
      sel.rolls = uri ? [uri] : [];
      rollSel.value = uri || "";
      updateObservation();
      const film = filmForRoll(uri);
      sel.recipe = null;
      if (film) {
        sel.film = film;
        filmSearch.value = `${film.make} ${film.name}`;
      } else if (uri) {
        sel.film = null;
        filmSearch.value = "";
      }
    };
    rollSel.addEventListener("change", () => {
      selectRoll(rollSel.value);
      renderStage();
    });
    const renderFilms = () => {
      filmList.replaceChildren(
        ...searchFilms(filmSearch.value, 30).map((f) =>
          el(
            "button",
            {
              class: "devtimer-opt" + (sel.film && sel.film.key === f.key ? " on" : ""),
              onclick: () => {
                sel.film = f;
                sel.recipe = null;
                renderStage();
              },
            },
            [
              el("span", {}, `${f.make} ${f.name}`),
              el("span", { class: "muted small" }, `${f.count} recipe${f.count === 1 ? "" : "s"}`),
            ],
          ),
        ),
      );
    };
    filmSearch.addEventListener("input", renderFilms);

    function renderStage() {
      stage.replaceChildren();
      if (availableRolls.length) {
        stage.append(el("label", { class: "field" }, [el("span", {}, "Roll (optional)"), rollSel]));
      }
      stage.append(el("label", { class: "field" }, [el("span", {}, "Film"), filmSearch]), filmList);
      renderFilms();
      if (!sel.film) return;

      // recipe options for this film
      const recipes = recipesForFilm(sel.film.make, sel.film.name);
      const suggestedRecipe = closestExposureRecipe(recipes, sel.observation);
      const evidence = el("div", { class: "devtimer-exposure-evidence", role: "status" });
      const paintEvidence = () => {
        const text = sel.recipe
          ? selectedVsObservedText(sel.observation, sel.recipe)
          : exposureSuggestionText(sel.observation);
        evidence.replaceChildren(
          el("strong", {}, sel.observation ? "Exposure evidence" : "Exposure evidence unavailable"),
          el(
            "p",
            {},
            `${text}${sel.observation ? " Choose a published recipe; the suggestion never changes the selection automatically." : ""}`,
          ),
        );
      };
      paintEvidence();
      refreshExposureEvidence = () => {
        updateObservation();
        if (sel.recipe) paintEvidence();
        else renderStage();
      };
      if (sel.rolls.length) stage.append(evidence);
      const recWrap = el("div", { class: "devtimer-list" });
      for (const r of recipes) {
        const temps = publishedTemps(r)
          .map((t) => `${c10ToC(t)}°`)
          .join(", ");
        recWrap.append(
          el(
            "button",
            {
              class:
                "devtimer-opt" + (sel.recipe === r ? " on" : "") + (suggestedRecipe === r ? " devtimer-suggested" : ""),
              onclick: () => {
                sel.recipe = r;
                sel.tempC10 = defaultTemp(r);
                sel.actualTempC10 = sel.tempC10;
                sel.manualDevSec = null;
                sel.publishedDevSec = null;
                sel.recommendation = null;
                renderStage();
              },
            },
            [
              el("span", {}, recipeLabel(r)),
              el(
                "span",
                { class: "muted small" },
                `${r.process.toUpperCase()} · ${temps} · ${recipeRecommendationStatus(r)}`,
              ),
              suggestedRecipe === r ? el("span", { class: "devtimer-suggestion-tag" }, "Closest EI") : null,
            ],
          ),
        );
      }
      stage.append(el("h4", { class: "stat-h" }, "Recipe"), recWrap);
      if (!sel.recipe) return;

      // temperature + resolved develop time
      const r = sel.recipe;
      const tempIn = el("input", {
        type: "number",
        step: "0.1",
        class: "date-input",
        value: String(c10ToC(sel.tempC10)),
      });
      const actualTempIn = el("input", {
        type: "number",
        step: "0.1",
        class: "date-input",
        value: String(c10ToC(sel.actualTempC10 ?? sel.tempC10)),
      });
      const syncTempValueText = bindValueText(tempIn, (value) => `Recipe setpoint ${value} degrees Celsius`);
      const syncActualTempValueText = bindValueText(
        actualTempIn,
        (value) => `Actual temperature ${value} degrees Celsius`,
      );
      let actualTemperatureEdited = false;
      const devLine = el("div", { class: "devtimer-devtime" });
      const manualWrap = el("div");
      let technical = null;
      const manualIn = el("input", { type: "text", class: "date-input", placeholder: "m:ss (e.g. 6:45)" });
      // optional: link the physical chemistry bottle so its rolls-processed count
      // climbs as you develop (drives the Chemistry status card in Insights).
      const chems = ctx.store?.instance?.chemistry || [];
      const chemSel = el("select", { class: "date-input" }, [
        el("option", { value: "" }, "(none — don't track)"),
        ...chems.map((c) => el("option", { value: c.uri }, instanceLabel("chemistry", c.value, ctx.store))),
      ]);
      const startBtn = el("button", { class: "log-btn", disabled: true }, "Start development");

      const recompute = () => {
        sel.tempC10 = cToC10(parseFloat(tempIn.value) || 20);
        const recommendation = resolveTimeRecommendation(r, sel.tempC10);
        const datasheet = recommendation?.timeSec ?? null;
        sel.recommendation = recommendation;
        manualWrap.replaceChildren();
        if (datasheet != null) {
          sel.manualDevSec = datasheet;
          sel.publishedDevSec = datasheet;
          devLine.className = "devtimer-devtime ok";
          devLine.textContent =
            recommendation.kind === "interpolated"
              ? `Develop ${fmtMMSS(datasheet)} at ${c10ToC(sel.tempC10)}°C (recommendation: derived · ${recommendation.interpolationMethod} interpolation)`
              : `Develop ${fmtMMSS(datasheet)} at ${c10ToC(sel.tempC10)}°C (recommendation: ${recommendation.recommendationStatus} · exact published row)`;
          startBtn.disabled = false;
        } else {
          sel.publishedDevSec = null;
          const range = publishedTemps(r)
            .map((t) => `${c10ToC(t)}°`)
            .join(", ");
          devLine.className = "devtimer-devtime warn";
          const why = r.interpolationAllowed === true ? "No supported recipe time" : "Interpolation is not permitted";
          devLine.textContent = `${why} at ${c10ToC(sel.tempC10)}°C. Published rows: ${range}. Enter an observed/manual time:`;
          manualWrap.append(el("label", { class: "field" }, [el("span", {}, "Your develop time"), manualIn]));
          const parsed = parseMMSS(manualIn.value);
          sel.manualDevSec = parsed;
          startBtn.disabled = parsed == null;
        }
        if (technical) {
          const next = recipeTechnicalDetails(r, recommendation);
          technical.replaceWith(next);
          technical = next;
        }
      };
      tempIn.addEventListener("input", () => {
        recompute();
        if (!actualTemperatureEdited) {
          sel.actualTempC10 = sel.tempC10;
          actualTempIn.value = String(c10ToC(sel.tempC10));
          syncActualTempValueText();
        }
      });
      actualTempIn.addEventListener("input", () => {
        actualTemperatureEdited = true;
        sel.actualTempC10 = cToC10(parseFloat(actualTempIn.value) || c10ToC(sel.tempC10));
      });
      syncTempValueText();
      manualIn.addEventListener("input", () => {
        sel.manualDevSec = parseMMSS(manualIn.value);
        startBtn.disabled = sel.manualDevSec == null;
      });

      startBtn.addEventListener("click", () => {
        cues.unlock();
        const developStep = {
          name: "Develop",
          roles: ["film-developer"],
          seconds: sel.manualDevSec,
          agitation: r.agitation || null,
        };
        const steps = defaultChain(r.process, developStep).map((s) => ({ ...s, actualSec: null }));
        const document = recipeDocument(r);
        const state = {
          film: `${sel.film.make} ${sel.film.name}`,
          developer: recipeLabel(r),
          dilution: r.dilution || null,
          process: r.process,
          tempC10: sel.tempC10,
          actualTempC10: sel.actualTempC10 ?? sel.tempC10,
          publishedTimeSeconds: sel.publishedDevSec,
          recommendationStatus: sel.recommendation?.recommendationStatus || "observed",
          selectedTimeKind: sel.recommendation?.kind || "manual",
          recipe: recipeUri(ctx.store, r),
          source: r.source,
          sourceDocument: document,
          sourceSpec: sel.recommendation ? recipeSourceSpec(r, document, sel.recommendation) : null,
          pushPull: r.pushPull || null,
          exposureEvidence: selectedVsObservedText(sel.observation, r),
          tankType: r.tankType || "tank",
          chemistry: chemSel.value || null,
          rolls: sel.rolls,
          steps,
          index: 0,
          running: false,
          endsAt: null,
          remaining: steps[0].seconds,
          startedAt: new Date().toISOString(),
        };
        startRun(state, false);
      });

      technical = recipeTechnicalDetails(r, sel.recommendation);
      stage.append(
        el("h4", { class: "stat-h" }, "Temperature"),
        el("div", { class: "devtimer-temperature-grid" }, [
          el("label", { class: "field" }, [el("span", {}, "Recipe setpoint °C"), tempIn]),
          el("label", { class: "field" }, [el("span", {}, "Actual temperature °C"), actualTempIn]),
        ]),
        devLine,
        manualWrap,
        technical,
        chems.length
          ? el("label", { class: "field" }, [el("span", {}, "Chemistry (optional — tracks usage)"), chemSel])
          : null,
        el(
          "p",
          { class: "muted small" },
          "Following steps (stop / fix / wash) are editable defaults, not datasheet times.",
        ),
        startBtn,
      );
      recompute();
    }
    if (rollSel.value) selectRoll(rollSel.value);
    else updateObservation();
    renderStage();
  }

  // -- run phase -------------------------------------------------------------
  function startRun(state, resumed) {
    requestWake();
    let lastAgIndexCue = -1;

    const bigTime = el("div", { class: "devtimer-time" }, "0:00");
    const stepName = el("div", {
      class: "devtimer-step",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    });
    const stepMeta = el("div", { class: "muted small" });
    const bar = el("div", { class: "devtimer-bar" }, [el("div", { class: "devtimer-fill" })]);
    const agBanner = el("div", { class: "devtimer-agitate" }, "Agitate");
    const primary = el("button", { class: "log-btn" });
    const nudgeMinus = el("button", { class: "log-btn secondary", onclick: () => nudge(-15) }, "−15s");
    const nudgePlus = el("button", { class: "log-btn secondary", onclick: () => nudge(15) }, "+15s");
    const skip = el("button", { class: "log-btn secondary", onclick: () => completeStep(true) }, "Step done ›");
    const finishBtn = el("button", { class: "ghost small-btn", onclick: () => finish() }, "Finish & log");
    const cueMode = el("button", {
      class: "ghost small-btn",
      type: "button",
      "aria-label": "Use visual-only timer cues",
      onclick: () => {
        visualOnly = !visualOnly;
        cues.setEnabled(!visualOnly);
        paintCueMode();
      },
    });
    const cancelBtn = el(
      "button",
      {
        class: "ghost small-btn",
        onclick: () => {
          if (confirm("Discard this development run?")) {
            clearDevRun(ctx.did);
            close();
          }
        },
      },
      "Discard",
    );

    const fill = () => bar.querySelector(".devtimer-fill");
    const curStep = () => state.steps[state.index];
    const paintCueMode = () => {
      cueMode.textContent = visualOnly ? "Cues: visual only" : "Cues: sound + haptic";
      cueMode.setAttribute("aria-pressed", String(visualOnly));
    };
    paintCueMode();

    function render() {
      const s = curStep();
      stepName.textContent = s ? s.name : "Done";
      stepMeta.textContent = s
        ? `Step ${state.index + 1} of ${state.steps.length}${s.roles?.some((role) => role.endsWith("developer")) ? ` · ${state.developer} · ${c10ToC(state.tempC10)}°C` : ""}`
        : "All steps complete";
      primary.textContent = state.running ? "Pause" : state.remaining === s?.seconds ? "Start step" : "Resume";
      const total = s ? s.seconds : 1;
      const rem = state.remaining;
      bigTime.textContent = fmtMMSS(rem);
      fill().style.width = `${Math.max(0, Math.min(100, (1 - rem / total) * 100))}%`;
      body.dataset.developing = state.running ? "1" : "0";
    }

    function persist() {
      saveDevRun(ctx.did, state);
    }

    function tick() {
      if (!state.running || state.endsAt == null) return;
      const rem = (state.endsAt - Date.now()) / 1000;
      state.remaining = Math.max(0, rem);
      // agitation cueing during the develop step
      const s = curStep();
      if (s?.agitation && (s.agitation.everySec || s.agitation.initialSec)) {
        const elapsed = s.seconds - state.remaining;
        const ag = s.agitation;
        let active = false,
          cueIdx = -1;
        if (ag.initialSec && elapsed <= ag.initialSec) {
          active = true;
          cueIdx = 0;
        } else if (ag.everySec) {
          const since = elapsed - (ag.initialSec || 0);
          const inCycle = ((since % ag.everySec) + ag.everySec) % ag.everySec;
          if (inCycle < (ag.forSec || 5)) {
            active = true;
            cueIdx = Math.floor(since / ag.everySec) + 1;
          }
        }
        agBanner.classList.toggle("on", active && state.remaining > 0);
        if (active && cueIdx !== lastAgIndexCue) {
          cues.agitate();
          lastAgIndexCue = cueIdx;
        }
      } else {
        agBanner.classList.remove("on");
      }
      if (state.remaining <= 0) {
        completeStep(false);
        return;
      }
      render();
    }

    function startOrPause() {
      const s = curStep();
      if (!s) return;
      if (state.running) {
        state.remaining = Math.max(0, (state.endsAt - Date.now()) / 1000);
        state.running = false;
        state.endsAt = null;
      } else {
        state.running = true;
        state.endsAt = Date.now() + state.remaining * 1000;
        lastAgIndexCue = -1;
      }
      persist();
      render();
    }
    function nudge(delta) {
      state.remaining = Math.max(0, state.remaining + delta);
      if (state.running) state.endsAt = Date.now() + state.remaining * 1000;
      persist();
      render();
    }
    function completeStep(manual) {
      const s = curStep();
      if (!s) return;
      s.actualSec = Math.round(s.seconds - (manual ? state.remaining : 0));
      if (!manual) cues.stepEnd();
      state.index += 1;
      state.running = false;
      state.endsAt = null;
      if (state.index >= state.steps.length) {
        cues.done();
        persist();
        render();
        primary.disabled = true;
        toast("Development complete — tap Finish & log", "ok", 5000);
        return;
      }
      state.remaining = state.steps[state.index].seconds;
      lastAgIndexCue = -1;
      persist();
      render();
    }
    async function finish() {
      // mark current step actual if mid-run
      const s = curStep();
      if (s && s.actualSec == null) s.actualSec = Math.round(s.seconds - state.remaining);
      const dev = state.steps[0];
      const selectionNote =
        state.selectedTimeKind === "interpolated"
          ? "Selected time recommendation was derived by interpolation; actual time and temperature were observed during this timer run."
          : state.selectedTimeKind === "published"
            ? `Selected time used an exact published recipe row (${state.recommendationStatus || "unknown"}); actual time and temperature were observed during this timer run.`
            : "Selected time was entered manually; actual time and temperature were observed during this timer run.";
      const finishedAt = new Date().toISOString();
      const rec = {
        process: state.process, // faithful (bw / monobath / c41 / …)
        recipe: state.recipe || undefined,
        sourceDocument: state.sourceDocument || undefined,
        sourceSpec: state.sourceSpec || undefined,
        temperature: { unit: "celsius", value: state.actualTempC10 ?? state.tempC10, scale: 10 },
        temperatureSetpoint: { unit: "celsius", value: state.tempC10, scale: 10 },
        actualTemperature: { unit: "celsius", value: state.actualTempC10 ?? state.tempC10, scale: 10 },
        timeSeconds: dev.actualSec ?? dev.seconds,
        publishedTimeSeconds: state.publishedTimeSeconds ?? undefined,
        actualTimeSeconds: dev.actualSec ?? dev.seconds,
        dilution: state.dilution || undefined,
        chemistry: state.chemistry || undefined,
        tankType: state.tankType || "tank",
        agitation: dev.agitation?.note || undefined,
        agitationScheme: dev.agitation || undefined,
        pushPull: state.pushPull || undefined,
        filmRolls: state.rolls?.length ? state.rolls : undefined,
        steps: state.steps
          .filter((step) => step.roles?.length)
          .map((step) => ({
            roles: step.roles,
            chemistry: step.roles.some((role) => role.endsWith("developer")) ? state.chemistry || undefined : undefined,
            timeSeconds: step.actualSec ?? step.seconds,
            agitation: step.agitation?.note || undefined,
          })),
        startedAt: state.startedAt,
        finishedAt,
        notes: `${state.film} in ${state.developer}${state.dilution && state.dilution !== "stock" ? ` ${state.dilution}` : ""} at ${c10ToC(state.tempC10)}°C. Steps: ${state.steps.map((x) => `${x.name} ${fmtMMSS(x.actualSec ?? x.seconds)}`).join(", ")}. Logged via timer (source: ${state.source}).${state.exposureEvidence ? ` ${state.exposureEvidence}` : ""}`,
        provenance: {
          source: "manual",
          assertedAt: new Date().toISOString(),
          note: [selectionNote, state.exposureEvidence].filter(Boolean).join(" "),
        },
        createdAt: new Date().toISOString(),
      };
      const sessionOperation = outbox.enqueue(ctx.did, NS.process.developSession, rec);
      for (const uri of state.rolls || []) {
        const roll = (ctx.store?.instance?.filmRoll || []).find((candidate) => candidate.uri === uri);
        if (!roll) continue;
        await saveRecord(
          ctx.agent,
          ctx.did,
          NS.instance.filmRoll,
          {
            ...roll.value,
            status: "developed",
            developedAt: roll.value.developedAt || finishedAt,
            developmentLocation: "home",
            updatedAt: finishedAt,
          },
          roll,
        );
      }
      // bump the linked chemistry's usage so its capacity/age card reflects reality
      // (best-effort, online — a putRecord isn't offline-queued).
      if (state.chemistry) {
        const c = (ctx.store?.instance?.chemistry || []).find((x) => x.uri === state.chemistry);
        if (c) {
          const n = Math.max(1, state.rolls?.length || 1);
          saveRecord(
            ctx.agent,
            ctx.did,
            NS.instance.chemistry,
            {
              ...c.value,
              rollsProcessed: (c.value.rollsProcessed || 0) + n,
              sessionsUsed: (c.value.sessionsUsed || 0) + 1,
              updatedAt: new Date().toISOString(),
            },
            c,
          ).catch(() => {});
        }
      }
      if (opts.onSessionLogged) {
        try {
          await opts.onSessionLogged({
            sessionUri: sessionOperation.tempUri,
            rollUris: state.rolls || [],
            completedAt: finishedAt,
          });
        } catch (error) {
          toast(
            `Development was logged, but its workflow could not be advanced: ${error?.message || error}`,
            "err",
            6000,
          );
        }
      }
      clearDevRun(ctx.did);
      toast(
        outbox.isOnline() ? "Development logged ✓" : "Logged offline — will sync",
        outbox.isOnline() ? "ok" : "info",
        2600,
      );
      outbox.flush(ctx.agent, ctx.did).catch(() => {});
      close();
    }

    primary.addEventListener("click", startOrPause);

    body.replaceChildren(
      el("div", { class: "logger-top row between" }, [el("strong", {}, state.film), cueMode, cancelBtn]),
      el("div", { class: "devtimer-run" }, [
        stepName,
        stepMeta,
        agBanner,
        bigTime,
        bar,
        el("div", { class: "row devtimer-controls" }, [nudgeMinus, primary, nudgePlus]),
        el("div", { class: "row devtimer-controls" }, [skip, finishBtn]),
      ]),
    );
    // if resumed while running, re-anchor the countdown to wall-clock
    if (resumed && state.running && state.endsAt != null) {
      /* endsAt is absolute; tick recomputes */
    } else if (resumed) {
      state.running = false;
    }
    render();
    run.timer = setInterval(tick, 250);
    if (resumed && state.running) toast("Resumed development in progress", "info", 2600);
  }
}

function defaultTemp(recipe) {
  const temps = publishedTemps(recipe);
  if (temps.includes(200)) return 200; // prefer 20°C when published
  return temps[0] ?? 200;
}
