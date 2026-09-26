import { el } from "@hypo/ui";
import type { ActivityServices } from "./maintenance-types.ts";

export function countUp(node: HTMLElement, target: number): void {
  if (target <= 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    node.textContent = String(target);
    return;
  }
  const start = performance.now();
  const duration = 620;
  const tick = (now: number) => {
    const elapsed = Math.min(1, (now - start) / duration);
    node.textContent = String(Math.round(target * (1 - Math.pow(1 - elapsed, 3))));
    if (elapsed < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function metric(label: string, value: number, onOpen?: () => unknown): HTMLElement {
  const number = el("div", { class: "metric-num" }, "0");
  requestAnimationFrame(() => countUp(number, value));
  return el(
    onOpen ? "button" : "div",
    { class: `metric${onOpen ? " metric-link" : ""}`, type: onOpen ? "button" : undefined, onclick: onOpen },
    [number, el("div", { class: "metric-label muted small" }, label)],
  );
}

export function renderChemistryStatus(body: HTMLElement, services: ActivityServices): void {
  const chemistry = services.getStore().instance.chemistry || [];
  if (!chemistry.length) return;
  const now = Date.now();
  const rows = el("div", { class: "gear-list" });
  for (const item of chemistry) {
    const value = item.value;
    const capacity = value.volumeMl;
    const remaining = value.volumeRemainingMl;
    const percent =
      capacity != null && remaining != null && capacity > 0
        ? Math.max(0, Math.min(100, Math.round((remaining / capacity) * 100)))
        : value.maxRollsRecommended > 0 && value.rollsProcessed != null
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(((value.maxRollsRecommended - value.rollsProcessed) / value.maxRollsRecommended) * 100),
              ),
            )
          : null;
    const expired = value.expiresAt && Date.parse(value.expiresAt) < now;
    const ageDays = value.mixedAt ? Math.floor((now - Date.parse(value.mixedAt)) / 86_400_000) : null;
    const details: string[] = [];
    if (value.rollsProcessed != null)
      details.push(`${value.rollsProcessed} roll${value.rollsProcessed === 1 ? "" : "s"}`);
    if (ageDays != null) details.push(`${ageDays}d old`);
    if (expired) details.push("past use-by");
    const capacityLabel =
      capacity != null && remaining != null
        ? `${remaining} of ${capacity} mL remaining`
        : value.maxRollsRecommended > 0 && value.rollsProcessed != null
          ? `${value.rollsProcessed} of ${value.maxRollsRecommended} recommended rolls used`
          : null;
    const level = percent == null ? "" : percent <= 15 ? " critical" : percent <= 35 ? " caution" : " healthy";
    rows.append(
      el("div", { class: `gear-row chemistry-status-row${expired ? " warn-row" : ""}` }, [
        el("div", { class: "chemistry-status-copy" }, [
          el("strong", {}, services.instanceLabel("chemistry", value)),
          details.length ? el("span", { class: "muted small" }, details.join(" · ")) : null,
        ]),
        percent != null && capacityLabel
          ? el("div", { class: "chemistry-capacity" }, [
              el("span", { class: "chemistry-capacity-label muted small" }, capacityLabel),
              el(
                "span",
                {
                  class: `chemistry-capacity-track${level}`,
                  role: "progressbar",
                  "aria-label": capacityLabel,
                  "aria-valuemin": "0",
                  "aria-valuemax": "100",
                  "aria-valuenow": String(percent),
                },
                [el("span", { class: "chemistry-capacity-fill", style: `width:${percent}%` })],
              ),
            ])
          : el("span", { class: "muted small chemistry-capacity-untracked" }, "Capacity not tracked"),
      ]),
    );
  }
  body.append(
    el("div", { class: "card" }, [
      el("h3", {}, "Chemistry status"),
      el(
        "p",
        { class: "muted small" },
        "The meter uses remaining volume when it is recorded, then falls back to the manufacturer's recommended roll limit. Development sessions update the roll count.",
      ),
      rows,
    ]),
  );
}

export function renderLibraryOverview(body: HTMLElement, services: ActivityServices): void {
  const store = services.getStore();
  const instanceCount = (kind: string) => (store.instance[kind] || []).length;
  const typeCount = (kind: string) => (store.catalog[kind] || []).length;
  body.append(
    el("div", { class: "card" }, [
      el("h2", {}, "Library at a glance"),
      el("p", { class: "muted small" }, "The materials, equipment, and services available for your next session."),
      el("div", { class: "metric-grid" }, [
        metric("Film rolls", instanceCount("filmRoll")),
        metric("Film stocks", typeCount("filmStock")),
        metric("Cameras", instanceCount("camera")),
        metric("Lenses", instanceCount("lens")),
        metric("Chemistry", instanceCount("chemistry")),
        metric("Scanners", instanceCount("scanner")),
        metric("Labs", instanceCount("labAccount")),
        metric("Storage locations", instanceCount("storageLocation")),
      ]),
    ]),
  );
  renderChemistryStatus(body, services);

  const rolls = store.instance.filmRoll || [];
  if (!rolls.length) return;
  const byStatus = new Map<string, number>();
  for (const roll of rolls) {
    const status = roll.value.status || "unknown";
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }
  const rowData = [...byStatus].sort((left, right) => right[1] - left[1]);
  const maximum = Math.max(...rowData.map(([, count]) => count));
  const chart = el("div", { class: "bar-chart" });
  for (const [label, count] of rowData) {
    const fill = el("div", { class: "bar-fill", style: "width:0%" });
    requestAnimationFrame(() => (fill.style.width = `${Math.round((count / maximum) * 100)}%`));
    chart.append(
      el("div", { class: "bar-row" }, [
        el("span", { class: "bar-label mono small" }, services.enumLabel(label)),
        el("div", { class: "bar-track" }, [fill]),
        el("b", { class: "bar-val mono small" }, String(count)),
      ]),
    );
  }
  body.append(el("div", { class: "card" }, [el("h3", {}, "Film rolls by status"), chart]));
}

export function renderInsightsView(body: HTMLElement, services: ActivityServices): void {
  const store = services.getStore();
  const instanceCount = (kind: string) => (store.instance[kind] || []).length;
  const typeCount = (kind: string) => (store.catalog[kind] || []).length;
  body.append(
    el("div", { class: "card" }, [
      el("h2", {}, "Your gear at a glance"),
      el("div", { class: "metric-grid" }, [
        metric("Cameras", instanceCount("camera")),
        metric("Lenses", instanceCount("lens")),
        metric("Film rolls", instanceCount("filmRoll")),
        metric("Developments", (store.developSessions || []).length, () => services.navigateSessions?.("develop")),
        metric("Digitizations", (store.digitizeSessions || []).length, () => services.navigateSessions?.("digitize")),
        metric("Scanners", instanceCount("scanner")),
        metric("Film stocks", typeCount("filmStock")),
        metric("Chemistry", instanceCount("chemistry")),
      ]),
    ]),
  );
  renderChemistryStatus(body, services);

  const rolls = store.instance.filmRoll || [];
  if (rolls.length) {
    const byStatus = new Map<string, number>();
    for (const roll of rolls) {
      const status = roll.value.status || "unknown";
      byStatus.set(status, (byStatus.get(status) || 0) + 1);
    }
    const rowData = [...byStatus].sort((left, right) => right[1] - left[1]);
    const maximum = Math.max(...rowData.map(([, count]) => count));
    const chart = el("div", { class: "bar-chart" });
    for (const [label, count] of rowData) {
      const fill = el("div", { class: "bar-fill", style: "width:0%" });
      requestAnimationFrame(() => (fill.style.width = `${Math.round((count / maximum) * 100)}%`));
      chart.append(
        el("div", { class: "bar-row" }, [
          el("span", { class: "bar-label mono small" }, label),
          el("div", { class: "bar-track" }, [fill]),
          el("b", { class: "bar-val mono small" }, String(count)),
        ]),
      );
    }
    body.append(el("div", { class: "card" }, [el("h3", {}, "Film rolls by status"), chart]));
  }

  const usage = new Map<string, number>();
  for (const capture of store.photoCaptureByPhoto.values()) {
    for (const key of ["camera", "lens", "filmRoll"]) {
      const uri = capture.value[key];
      if (uri) usage.set(uri, (usage.get(uri) || 0) + 1);
    }
  }
  const top = [...usage].sort((left, right) => right[1] - left[1]).slice(0, 6);
  if (!top.length) return;
  const list = el("ul", { class: "gear-list" });
  for (const [uri, count] of top) {
    const entry = store.byUri.get(uri);
    const label = entry
      ? entry.layer === "instance"
        ? services.instanceLabel(entry.kind, entry.item.value)
        : services.catalogLabel(entry.kind, entry.item.value)
      : uri;
    list.append(el("li", { class: "gear-row row between" }, [el("span", {}, label), el("b", {}, `${count}×`)]));
  }
  body.append(el("div", { class: "card" }, [el("h3", {}, "Most used"), list]));
}
