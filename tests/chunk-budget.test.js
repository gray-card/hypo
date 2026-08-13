import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectChunks } from "../scripts/check-chunk-budgets.mjs";

describe("production chunk budget", () => {
  it("measures every JavaScript chunk independently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hypo-chunks-"));
    await writeFile(join(directory, "small.js"), "export default 1;\n");
    await writeFile(join(directory, "large.js"), `export default ${JSON.stringify("abcdef".repeat(1_000))};\n`);

    const chunks = await inspectChunks(directory, 50);
    expect(chunks.map((chunk) => chunk.name).sort()).toEqual(["large.js", "small.js"]);
    expect(chunks.find((chunk) => chunk.name === "large.js")?.gzip).toBeGreaterThan(50);
  });
});
