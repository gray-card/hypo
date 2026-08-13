import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  complementConflictDetails,
  conflictDiff,
  openComplementConflictTray,
  openConflictTray,
} from "../src/ui/conflictTray.js";

const operation = {
  id: "op-1",
  kind: "put",
  collection: "app.graycard.instance.exposure",
  uri: "at://did:plc:test/app.graycard.instance.exposure/frame-1",
  record: { frameNumber: 2, note: "local" },
  conflict: {
    message: "record changed remotely",
    remote: { cid: "cid-current", value: { frameNumber: 3, note: "remote" } },
  },
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("conflict tray", () => {
  it("surfaces schema complement failures without offering a destructive retry", () => {
    const error = Object.assign(new Error("fingerprint mismatch"), {
      name: "ComplementFingerprintMismatch",
      context: { recordUri: operation.uri, cid: "cid-current", chainId: "v1-to-v2" },
    });
    expect(complementConflictDetails(error)).toMatchObject({
      title: "Schema complement mismatch",
      recordUri: operation.uri,
      chainId: "v1-to-v2",
    });

    openComplementConflictTray(error);
    expect(document.body.textContent).toContain("Hypo stopped before writing");
    expect(document.body.textContent).toContain("v1-to-v2");
    expect([...document.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
      "Rebase local change",
    );
  });

  it("identifies changed local and remote fields", () => {
    expect(conflictDiff(operation)).toEqual([
      { field: "frameNumber", local: 2, remote: 3, changed: true },
      { field: "note", local: "local", remote: "remote", changed: true },
    ]);
  });

  it("rebases against the current remote CID and flushes", async () => {
    const sync = {
      conflicts: vi.fn().mockResolvedValueOnce([operation]).mockResolvedValueOnce([]),
      rebaseConflict: vi.fn().mockResolvedValue({}),
      flush: vi.fn().mockResolvedValue({ sent: 1, conflicts: 0 }),
      remove: vi.fn(),
    };
    const agent = {};
    await openConflictTray({ agent, did: "did:plc:test", sync });

    [...document.querySelectorAll("button")].find((button) => button.textContent === "Rebase local change").click();
    await vi.waitFor(() => expect(sync.flush).toHaveBeenCalledWith(agent, "did:plc:test"));
    expect(sync.rebaseConflict).toHaveBeenCalledWith("did:plc:test", "op-1", { swapRecord: "cid-current" });
    expect(document.body.textContent).toContain("Nothing needs attention");
  });

  it("discards a local conflict without touching the remote record", async () => {
    const sync = {
      conflicts: vi.fn().mockResolvedValueOnce([operation]).mockResolvedValueOnce([]),
      rebaseConflict: vi.fn(),
      flush: vi.fn(),
      remove: vi.fn().mockResolvedValue(true),
    };
    await openConflictTray({ agent: {}, did: "did:plc:test", sync });

    [...document.querySelectorAll("button")].find((button) => button.textContent === "Discard local change").click();
    await vi.waitFor(() => expect(sync.remove).toHaveBeenCalledWith("did:plc:test", "op-1"));
    expect(sync.flush).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Nothing needs attention"));
  });
});
