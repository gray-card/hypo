// onboarding.js: first-run wizard that walks a new user through building their
// setup: cameras → lenses → film → chemistry → a workflow inferred from the
// gear they picked. Everything is created as instances (types are silent).

import { el } from "./dom.js";
import { icon } from "./icons.js";
import { kindLabel, kindLabelPlural } from "./labels.js";
import { instanceLabel, saveWorkflowTemplate, loadStore } from "../graycard.js";
import { openAddGear, getStore, refreshStore } from "./library.js";

// which mediums the chosen cameras imply, so we can tailor later steps.
export function detectMediums(store) {
  let film = false, digital = false, instant = false;
  for (const cam of store.instance.camera || []) {
    const t = (store.catalog.cameraType || []).find((x) => x.uri === cam.value.type)?.value;
    const cat = t?.category;
    const fmt = t?.format || "";
    if (cat === "digital" || /-digital$/.test(fmt)) digital = true;
    else if (cat === "instant" || /^instax|^polaroid/.test(fmt)) instant = true;
    else if (cat === "film" || fmt) film = true;
  }
  return { film, digital, instant, any: film || digital || instant };
}

export async function openOnboarding({ agent, did, onDone }) {
  let store = getStore() || (await loadStore(agent, did));

  const overlay = el("div", { class: "wizard-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Set up your gear" });
  const card = el("div", { class: "wizard card" });
  overlay.append(card);
  document.body.append(overlay);

  const close = () => { overlay.remove(); onDone?.(); };

  // step definitions. Film/chemistry are only shown when film gear is present,
  // but that is decided live after the cameras step.
  const gearStep = (kind, title, subtitle) => ({ kind, title, subtitle, type: "gear" });
  const baseSteps = () => {
    const m = detectMediums(store);
    const steps = [
      { type: "welcome" },
      gearStep("camera", "Add your cameras", "Search for your bodies: film, digital, or instant. Start with one. You can add more later."),
      gearStep("lens", "Add your lenses", "Skip if your cameras have fixed lenses."),
    ];
    // show film + chemistry when there's any film gear, or nothing chosen yet
    if (m.film || !m.any) {
      steps.push(gearStep("filmRoll", "Add your film", "Add the stocks you shoot and how many rolls you have on hand."));
      steps.push(gearStep("developer", "Add your chemistry", "Developers and other chemistry you process with. Optional."));
    }
    steps.push({ type: "workflow" });
    steps.push({ type: "done" });
    return steps;
  };

  let steps = baseSteps();
  let i = 0;

  function progress() {
    const dots = el("div", { class: "wizard-dots" });
    steps.forEach((_, n) => dots.append(el("span", { class: "wizard-dot" + (n === i ? " active" : n < i ? " done" : "") })));
    return dots;
  }

  function footer({ next, nextLabel = "Next", skip = false, back = true } = {}) {
    return el("div", { class: "wizard-foot" }, [
      back && i > 0 ? el("button", { class: "ghost", onclick: () => { i--; render(); } }, "Back") : el("span", {}),
      el("div", { class: "row" }, [
        skip ? el("button", { class: "ghost", onclick: () => { i++; render(); } }, "Skip") : null,
        el("button", { onclick: next || (() => { i++; render(); }) }, nextLabel),
      ]),
    ]);
  }

  function gearList(kind) {
    const items = store.instance[kind] || [];
    if (!items.length) return el("p", { class: "muted small" }, "Nothing added yet.");
    const ul = el("ul", { class: "wizard-added" });
    for (const it of items) ul.append(el("li", {}, [icon("check", 15), el("span", {}, instanceLabel(kind, it.value, store))]));
    return ul;
  }

  async function refresh() { store = await refreshStore(); }

  function renderGear(step) {
    card.replaceChildren(
      progress(),
      el("h2", { class: "wizard-title" }, step.title),
      el("p", { class: "wizard-sub muted" }, step.subtitle),
      gearList(step.kind),
      el("button", { class: "wizard-add", onclick: () => openAddGear(step.kind, async () => { await refresh(); if (step.kind === "camera") steps = rebuildAfterCameras(); render(); }) },
        [icon("plus", 16), el("span", {}, `Add ${kindLabel(step.kind).toLowerCase()}`)]),
      footer({ skip: true }),
    );
  }

  // after cameras change, film/chemistry steps may appear/disappear
  function rebuildAfterCameras() {
    const cur = steps[i];
    const rebuilt = baseSteps();
    // keep pointing at the same (cameras) step
    const idx = rebuilt.findIndex((s) => s.type === "gear" && s.kind === cur.kind);
    if (idx >= 0) i = idx;
    return rebuilt;
  }

  function renderWelcome() {
    card.replaceChildren(
      progress(),
      el("div", { class: "wizard-hero" }, [icon("camera", 40)]),
      el("h2", { class: "wizard-title" }, "Let's build your setup"),
      el("p", { class: "wizard-sub muted" }, "Hypo is a tool for film and digital photographers that records the gear and process behind your photos. Add a few pieces of gear to get started. You can always add more."),
      el("div", { class: "wizard-foot" }, [
        el("button", { class: "ghost", onclick: close }, "I'll do this later"),
        el("button", { onclick: () => { i++; render(); } }, "Get started"),
      ]),
    );
  }

  function renderWorkflow() {
    const m = detectMediums(store);
    const madeNote = el("p", { class: "wizard-sub muted" }, "A workflow is a reusable sequence of stages with default gear. Load it when editing a gallery, then pick the ones that match how you work.");
    const buttons = el("div", { class: "wizard-choices" });
    const mkTemplate = async (name, medium, stageKinds) => {
      await saveWorkflowTemplate(agent, did, {
        name, medium, stageKinds, stageDefaults: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }, null);
      await refresh();
      toastCheck(name);
    };
    const made = new Set();
    const toastCheck = (name) => { made.add(name); render(); };
    const choice = (name, desc, medium, stages) =>
      el("button", { class: "wizard-choice" + (made.has(name) ? " chosen" : ""), disabled: made.has(name), onclick: () => mkTemplate(name, medium, stages) }, [
        el("div", { class: "row between" }, [el("strong", {}, name), made.has(name) ? icon("check", 16) : icon("plus", 16)]),
        el("div", { class: "muted small" }, desc),
      ]);

    const choices = [];
    if (m.film || !m.any) choices.push(choice("Film workflow", "Shoot → Develop → Scan", "film", ["capture", "develop", "digitize"]));
    if (m.digital) choices.push(choice("Digital workflow", "Shoot → Edit → Export", "digital", ["capture", "digital", "edit", "output"]));
    if (m.instant) choices.push(choice("Instant workflow", "Shoot → Scan", "instant", ["capture", "digitize"]));
    if (!choices.length) choices.push(choice("Film workflow", "Shoot → Develop → Scan", "film", ["capture", "develop", "digitize"]));
    choices.forEach((c) => buttons.append(c));

    card.replaceChildren(
      progress(),
      el("h2", { class: "wizard-title" }, "Set up a workflow"),
      madeNote, buttons,
      footer({ nextLabel: "Continue", skip: true }),
    );
  }

  function renderDone() {
    card.replaceChildren(
      progress(),
      el("div", { class: "wizard-hero" }, [icon("check", 40)]),
      el("h2", { class: "wizard-title" }, "You're set up"),
      el("p", { class: "wizard-sub muted" }, "Your gear lives under Setup. Next, open Galleries to link your photos to it, and Hypo will suggest matches from your gear automatically."),
      el("div", { class: "wizard-foot end" }, [el("button", { onclick: close }, "Go to my setup")]),
    );
  }

  function render() {
    const step = steps[Math.min(i, steps.length - 1)];
    if (step.type === "welcome") renderWelcome();
    else if (step.type === "gear") renderGear(step);
    else if (step.type === "workflow") renderWorkflow();
    else renderDone();
  }

  render();
  return { close };
}

// true when the user has no gear at all. The trigger for first-run onboarding.
export function needsOnboarding(store) {
  if (!store) return false;
  const kinds = ["camera", "lens", "filmRoll", "developer", "scanner", "chemistry", "enlarger"];
  return kinds.every((k) => !(store.instance[k]?.length));
}
