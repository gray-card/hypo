import { describe, expect, it } from "vitest";

import { readGearFormFields } from "../apps/web/src/views/library/gear-controls.ts";

const input = (value: string) => ({ value, addEventListener() {} });

describe("gear form scalar encoding", () => {
  it("writes every schema-declared integer control as a JSON integer", () => {
    const record = readGearFormFields(
      {
        maxRollsRecommended: input("16"),
        rollsProcessed: input("5"),
        sessionsUsed: input("1"),
      },
      {} as never,
    );

    expect(record).toMatchObject({ maxRollsRecommended: 16, rollsProcessed: 5, sessionsUsed: 1 });
    expect(typeof record.maxRollsRecommended).toBe("number");
  });

  it("rejects fractional integer controls before a record reaches the outbox", () => {
    expect(() => readGearFormFields({ maxRollsRecommended: input("1.5") }, {} as never)).toThrow(
      "Use a non-negative whole number",
    );
  });
});
