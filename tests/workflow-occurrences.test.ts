import { beforeEach, describe, expect, it } from "vitest";
import { createWorkflowOccurrenceEditor } from "../apps/web/src/views/library/workflow-occurrences.ts";

beforeEach(() => document.body.replaceChildren());

describe("workflow occurrence launcher", () => {
  it("collects bounded optional and repeatable counts for roll and shoot launchers", () => {
    const template = {
      uri: "at://did:plc:test/app.graycard.workflow.template/variable",
      value: {
        medium: "film",
        steps: [
          { id: "develop", kind: "develop", cardinality: { min: 1, max: 1 } },
          { id: "test-print", kind: "print", cardinality: { min: 1, max: 4 } },
          { id: "scan", kind: "digitize", optional: true, cardinality: { min: 0, max: 1 } },
        ],
      },
    };
    const select = document.createElement("select");
    select.append(new Option("None", ""), new Option("Variable", template.uri));
    const editor = createWorkflowOccurrenceEditor(select, [template], { print: "Print", digitize: "Digitize" });
    document.body.append(select, editor.node);
    select.value = template.uri;
    select.dispatchEvent(new Event("change"));
    const inputs = [...editor.node.querySelectorAll("input")];
    expect(inputs.map((input) => input.value)).toEqual(["1", "0"]);
    inputs[0].value = "3";
    inputs[1].value = "1";
    expect(editor.read()).toEqual({ "test-print": 3, scan: 1 });
    inputs[0].value = "5";
    expect(() => editor.read()).toThrow(/between 1 and 4/);
  });
});
