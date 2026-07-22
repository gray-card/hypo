import { describe, it, expect } from "vitest";
import { mockAgent } from "./setup.js";
import { publishSetup, unpublishSetup, listMySetups, getMySetup } from "../src/publish.js";
import { HYPO_REGISTRY, SETUP_NSID } from "../src/registry.js";

const DID = "did:plc:test";

describe("publishSetup / unpublishSetup", () => {
  it("creates a setup record linking to the frozen anchor", async () => {
    const agent = mockAgent();
    const res = await publishSetup(agent, DID, { name: "My 35mm kit", summary: "Tri-X + F2" });
    expect(agent.created).toHaveLength(1);
    const { collection, record } = agent.created[0];
    expect(collection).toBe(SETUP_NSID);
    expect(record.$type).toBe(SETUP_NSID);
    expect(record.registry).toBe(HYPO_REGISTRY);
    expect(record.name).toBe("My 35mm kit");
    expect(record.summary).toBe("Tri-X + F2");
    expect(record.createdAt).toBeTruthy();
    expect(res.uri).toContain(`/${SETUP_NSID}/`);
  });

  it("defaults a blank name and omits an empty summary", async () => {
    const agent = mockAgent();
    await publishSetup(agent, DID, { name: "   ", summary: "  " });
    const { record } = agent.created[0];
    expect(record.name).toBe("My setup");
    expect(record.summary).toBeUndefined();
  });

  it("updates in place with a compare-and-swap, preserving createdAt", async () => {
    const agent = mockAgent();
    const existing = {
      uri: `at://${DID}/${SETUP_NSID}/abc`, cid: "cidOld", rkey: "abc",
      value: { createdAt: "2020-01-01T00:00:00Z", name: "old" },
    };
    await publishSetup(agent, DID, { name: "new name" }, existing);
    expect(agent.created).toHaveLength(0);
    expect(agent.put).toHaveLength(1);
    expect(agent.put[0].rkey).toBe("abc");
    expect(agent.put[0].record.name).toBe("new name");
    expect(agent.put[0].record.createdAt).toBe("2020-01-01T00:00:00Z");
    expect(agent.put[0].record.registry).toBe(HYPO_REGISTRY);
  });

  it("caps the gear array", async () => {
    const agent = mockAgent();
    const gear = Array.from({ length: 250 }, (_, i) => `at://${DID}/app.graycard.instance.camera/${i}`);
    await publishSetup(agent, DID, { name: "big", gear });
    expect(agent.created[0].record.gear).toHaveLength(200);
  });

  it("unpublishSetup deletes by rkey", async () => {
    const agent = mockAgent();
    await unpublishSetup(agent, DID, "abc");
    expect(agent.deleted).toEqual([{ collection: SETUP_NSID, rkey: "abc" }]);
  });
});

describe("listMySetups / getMySetup", () => {
  function agentWith(records) {
    return { com: { atproto: { repo: { listRecords: async () => ({ data: { records } }) } } } };
  }

  it("returns setups newest-first with parsed rkeys", async () => {
    const agent = agentWith([
      { uri: `at://${DID}/${SETUP_NSID}/a`, cid: "c1", value: { createdAt: "2026-01-01T00:00:00Z", name: "old" } },
      { uri: `at://${DID}/${SETUP_NSID}/b`, cid: "c2", value: { createdAt: "2026-02-01T00:00:00Z", name: "new" } },
    ]);
    const list = await listMySetups(agent, DID);
    expect(list.map((s) => s.value.name)).toEqual(["new", "old"]);
    expect(list[0].rkey).toBe("b");
    expect(await getMySetup(agent, DID)).toMatchObject({ rkey: "b" });
  });

  it("getMySetup returns null when nothing is published", async () => {
    expect(await getMySetup(agentWith([]), DID)).toBeNull();
  });
});
