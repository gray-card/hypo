import { checkList, el } from "./dom.js";

function uniqueUris(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value))];
}

/**
 * An ordered multi-select for physical capture filters. Checking a filter adds
 * it to the camera end of the stack; unchecking it removes it without changing
 * the order of the remaining filters.
 */
export function createFilterStackControl(items, selected = [], label = (item) => item.uri) {
  let order = uniqueUris(selected).filter((uri) => items.some((item) => item.uri === uri));
  const list = checkList(
    items.map((item) => ({ value: item.uri, label: label(item) })),
    {
      selected: order,
      className: "check-list filter-stack-list",
      emptyMessage: el("p", { class: "muted small" }, "No filters in your library yet."),
    },
  );
  const summary = el("p", { class: "muted small filter-stack-summary", "aria-live": "polite" });
  const node = el("div", { class: "filter-stack-control" }, [
    list.node,
    summary,
    el("p", { class: "muted small" }, "Choose filters in light-path order: scene side first, camera side last."),
  ]);
  const paint = () => {
    const byUri = new Map(items.map((item) => [item.uri, item]));
    summary.textContent = order.length
      ? `Stack: ${order.map((uri, index) => `${index + 1}. ${label(byUri.get(uri))}`).join(" → ")}`
      : "Stack: none";
    node.dataset.selected = JSON.stringify(order);
  };
  const setSelected = (values) => {
    order = uniqueUris(values).filter((uri) => items.some((item) => item.uri === uri));
    const selectedSet = new Set(order);
    for (const input of list.inputs) input.checked = selectedSet.has(input.value);
    paint();
  };
  for (const input of list.inputs) {
    input.addEventListener("change", () => {
      if (input.checked && !order.includes(input.value)) order.push(input.value);
      else if (!input.checked) order = order.filter((uri) => uri !== input.value);
      paint();
    });
  }
  node.addEventListener("filter-stack-set", (event) => setSelected(event.detail));
  paint();
  return { node, inputs: list.inputs, getSelected: () => [...order], setSelected };
}
