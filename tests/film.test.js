import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TID } from "@atproto/common-web";
import { NS } from "../src/graycard.js";
import { splitRollFromStockpile } from "../src/filmReserve.js";
import { createFixturePds } from "./fixture-pds/index.js";

const did = "did:plc:alice";
const { filmRoll, filmStockpile } = NS.instance;
const camera = `at://${did}/${NS.instance.camera}/camera-a`;
const filmBack = `at://${did}/${NS.instance.filmBack}/back`;
const reserveRecord = {
  $type: filmStockpile,
  stock: `at://${did}/${NS.catalog.filmStock}/tri-x`,
  quantity: 10,
  format: "135",
  storage: "freezer",
  emulsionBatch: "2241",
  expiresAt: "2027-08-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00Z",
};
const template = {
  uri: `at://${did}/${NS.workflow.template}/bw`,
  value: {
    name: "Black and white",
    medium: "film",
    steps: [
      { id: "capture", kind: "capture" },
      { id: "develop", kind: "develop" },
    ],
  },
};

describe("splitRollFromStockpile", () => {
  let fixture;
  let agent;
  let stockpile;
  let call;
  let list;

  beforeEach(async () => {
    fixture = await createFixturePds({ seedPath: "tests/fixture-pds/seed.json" });
    call = async (method, input, body) => {
      const url = new URL(`/xrpc/com.atproto.${method}`, fixture.origin);
      for (const [key, value] of Object.entries(input || {})) url.searchParams.set(key, value);
      const response = await fetch(
        url,
        body && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.message), { status: response.status, error: data.error });
      return { data };
    };
    list = async (collection) => (await call("repo.listRecords", { repo: did, collection })).data.records;
    const getRecord = (input) => call("repo.getRecord", input);
    const rkey = TID.nextStr();
    await call("repo.createRecord", null, { repo: did, collection: filmStockpile, rkey, record: reserveRecord });
    stockpile = { ...(await getRecord({ repo: did, collection: filmStockpile, rkey })).data, rkey };
    agent = {
      com: {
        atproto: {
          repo: { getRecord, applyWrites: vi.fn((input) => call("repo.applyWrites", null, input)) },
          sync: { getLatestCommit: (input) => call("sync.getLatestCommit", input) },
        },
      },
    };
  });

  afterEach(async () => {
    await fixture?.close();
  });

  it("creates one loaded roll, decrements the reserve, and starts the linked workflow in one commit", async () => {
    const rollUri = await splitRollFromStockpile(agent, did, stockpile, { camera, label: "Roll 12", template });

    expect((await list(filmRoll)).filter((roll) => roll.value.stockpile === stockpile.uri)).toEqual([
      expect.objectContaining({
        uri: rollUri,
        value: expect.objectContaining({
          stock: reserveRecord.stock,
          status: "loaded",
          camera,
          label: "Roll 12",
          format: "135",
          storage: "freezer",
          emulsionBatch: "2241",
          expiresAt: reserveRecord.expiresAt,
          loadedAt: expect.any(String),
        }),
      }),
    ]);
    expect((await list(filmStockpile)).find((reserve) => reserve.uri === stockpile.uri).value).toMatchObject({
      quantity: 9,
      createdAt: reserveRecord.createdAt,
    });
    const run = (await list(NS.workflow.run)).find((entry) => entry.value.template === template.uri);
    expect(run.value.subjects).toEqual([{ kind: "film-roll-latent", ref: rollUri, label: "Roll 12" }]);
    const stages = await list(NS.workflow.stage);
    expect(run.value.stages).toHaveLength(2);
    expect(
      run.value.stages.map(
        ({ stage }) => stages.find((record) => record.uri === stage).value.stage.processDefaults.filmRoll,
      ),
    ).toEqual([rollUri, rollUri]);
    expect(stages.map(({ value }) => value.$type)).toEqual([NS.workflow.stage, NS.workflow.stage]);
    expect(agent.com.atproto.repo.applyWrites).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ swapCommit: expect.any(String), validate: false, writes: expect.any(Array) }),
      expect.any(Object),
    );
  });

  it("leaves the reserve untouched when a selected workflow cannot be prepared and allows a retry", async () => {
    await expect(
      splitRollFromStockpile(agent, did, stockpile, { template, occurrences: { capture: 0 } }),
    ).rejects.toThrow("Could not prepare the selected workflow");
    expect(agent.com.atproto.repo.applyWrites).not.toHaveBeenCalled();
    expect((await list(filmStockpile)).find((reserve) => reserve.uri === stockpile.uri).value.quantity).toBe(10);

    const uri = await splitRollFromStockpile(agent, did, stockpile, { camera, filmBack });
    const roll = (await list(filmRoll)).find((entry) => entry.uri === uri);
    expect(roll.value).toMatchObject({ filmBack, status: "loaded" });
    expect(roll.value).not.toHaveProperty("camera");
  });

  it("rejects stale and empty reserves without creating an extra roll", async () => {
    const first = await splitRollFromStockpile(agent, did, stockpile);
    await expect(splitRollFromStockpile(agent, did, stockpile)).rejects.toThrow("The reserve changed");
    await call("repo.putRecord", null, {
      repo: did,
      collection: filmStockpile,
      rkey: stockpile.rkey,
      record: { ...reserveRecord, quantity: 0 },
    });
    const empty = (await list(filmStockpile)).find((entry) => entry.uri === stockpile.uri);
    await expect(splitRollFromStockpile(agent, did, { ...empty, rkey: stockpile.rkey })).rejects.toThrow(
      "reserve is empty",
    );
    expect(
      (await list(filmRoll)).filter((roll) => roll.value.stockpile === stockpile.uri).map((roll) => roll.uri),
    ).toEqual([first]);
  });

  it("recognizes the same roll on retry when the commit response and first confirmation are lost", async () => {
    const rkey = TID.nextStr();
    const { applyWrites } = agent.com.atproto.repo;
    applyWrites.mockImplementationOnce(async (input) => {
      await call("repo.applyWrites", null, input);
      vi.spyOn(agent.com.atproto.repo, "getRecord").mockRejectedValueOnce(new TypeError("disconnected"));
      throw new TypeError("response lost");
    });
    await expect(splitRollFromStockpile(agent, did, stockpile, { rkey, template })).rejects.toThrow(
      "could not confirm the load",
    );
    const uri = await splitRollFromStockpile(agent, did, stockpile, { rkey });

    expect(uri).toBe(`at://${did}/${filmRoll}/${rkey}`);
    expect(applyWrites).toHaveBeenCalledTimes(1);
    expect((await list(filmStockpile)).find((reserve) => reserve.uri === stockpile.uri).value.quantity).toBe(9);
    expect(
      (await list(NS.workflow.run)).filter((run) => run.value.subjects?.some(({ ref }) => ref === uri)),
    ).toHaveLength(1);
  });

  it("lets only one of two concurrent loads consume the same reserve snapshot", async () => {
    const results = await Promise.allSettled([
      splitRollFromStockpile(agent, did, stockpile, { template }),
      splitRollFromStockpile(agent, did, stockpile, { template }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await list(filmStockpile)).find((reserve) => reserve.uri === stockpile.uri).value.quantity).toBe(9);
    expect((await list(filmRoll)).filter((roll) => roll.value.stockpile === stockpile.uri)).toHaveLength(1);
    expect((await list(NS.workflow.run)).filter((run) => run.value.template === template.uri)).toHaveLength(1);
  });
});
