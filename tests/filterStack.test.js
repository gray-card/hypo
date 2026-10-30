import { describe, expect, it } from "vitest";
import { createFilterStackControl } from "../src/ui/filterStack.js";

describe("ordered filter stack control", () => {
  const items = [
    { uri: "at://filter/yellow", value: { nickname: "Yellow" } },
    { uri: "at://filter/polarizer", value: { nickname: "Polarizer" } },
  ];

  it("records selection order and supports copying or clearing a stack", () => {
    const control = createFilterStackControl(items, [], (item) => item.value.nickname);
    control.inputs[1].checked = true;
    control.inputs[1].dispatchEvent(new Event("change"));
    control.inputs[0].checked = true;
    control.inputs[0].dispatchEvent(new Event("change"));
    expect(control.getSelected()).toEqual(["at://filter/polarizer", "at://filter/yellow"]);
    expect(control.node.textContent).toContain("1. Polarizer → 2. Yellow");

    control.node.dispatchEvent(new CustomEvent("filter-stack-set", { detail: ["at://filter/yellow"] }));
    expect(control.getSelected()).toEqual(["at://filter/yellow"]);
    control.setSelected([]);
    expect(control.getSelected()).toEqual([]);
  });
});
