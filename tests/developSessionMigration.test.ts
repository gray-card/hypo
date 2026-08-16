import { readFileSync } from "node:fs";

import { validateRecord } from "@hypo/lexicon";
import { AtprotoAgentAdapter, PublicRepoClient, RepoClient } from "@hypo/pds";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEVELOP_SESSION,
  LEGACY_DEVELOPMENT_SUMMARY_FIELDS,
  migrateDevelopSessions,
  migrateDevelopSessionsWithClient,
  migrateDevelopSessionValue,
} from "../src/developSessionMigration.ts";
import { createFixturePds } from "./fixture-pds/index.js";

const fixtureDocument = JSON.parse(readFileSync("fixtures/migrations/aaronstevenwhite-development.json", "utf8"));
const REPO = fixtureDocument.source.did as string;

function fixtureAgent(origin: string) {
  async function responseData(response: Response) {
    const body = await response.json();
    if (response.ok) return { data: body };
    throw Object.assign(new Error(body.message), { status: response.status, error: body.error });
  }

  async function query(method: string, input: Record<string, unknown>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return responseData(await fetch(`${origin}/xrpc/${method}?${params}`));
  }

  async function procedure(method: string, input: Record<string, unknown>) {
    return responseData(
      await fetch(`${origin}/xrpc/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  return {
    com: {
      atproto: {
        repo: {
          describeRepo: (input: Record<string, unknown>) => query("com.atproto.repo.describeRepo", input),
          listRecords: (input: Record<string, unknown>) => query("com.atproto.repo.listRecords", input),
          applyWrites: (input: Record<string, unknown>) => procedure("com.atproto.repo.applyWrites", input),
        },
        sync: {
          getLatestCommit: (input: Record<string, unknown>) => query("com.atproto.sync.getLatestCommit", input),
        },
      },
    },
  };
}

describe("development-session schema migration", () => {
  const fixtures: Array<Awaited<ReturnType<typeof createFixturePds>>> = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  });

  async function aaronFixture() {
    const fixture = await createFixturePds({
      seed: { records: fixtureDocument.records },
      versionedRecordsPath: false,
    });
    fixtures.push(fixture);
    const agent = fixtureAgent(fixture.origin);
    const client = new RepoClient(new AtprotoAgentAdapter(agent as never));
    return { fixture, agent, client, reader: new PublicRepoClient(fixture.origin) };
  }

  it("normalizes summary fields and shortcut baths into ordered stages", () => {
    const source = {
      $type: DEVELOP_SESSION,
      process: "bw",
      chemistry: "at://did:plc:test/app.graycard.instance.chemistry/developer",
      dilution: "1+1",
      actualTimeSeconds: 570,
      actualTemperature: { unit: "celsius", value: 20, scale: 1 },
      agitationScheme: { everySec: 60, forSec: 10, inversions: 4 },
      stopBathChemistry: "at://did:plc:test/app.graycard.instance.chemistry/stop",
      fixerChemistry: "at://did:plc:test/app.graycard.instance.chemistry/fixer",
      createdAt: "2026-08-01T12:00:00.000Z",
    };
    const primary = {
      name: "Developer",
      kind: "chemical-bath",
      roles: ["film-developer"],
      chemistries: [source.chemistry],
      dilution: source.dilution,
      actualTimeSeconds: source.actualTimeSeconds,
      actualTemperature: source.actualTemperature,
      agitationScheme: source.agitationScheme,
    };

    const migrated = migrateDevelopSessionValue(source, primary);
    expect(migrated.steps).toEqual([
      primary,
      {
        name: "Stop bath",
        kind: "chemical-bath",
        roles: ["stop"],
        chemistries: [source.stopBathChemistry],
      },
      {
        name: "Fixer",
        kind: "chemical-bath",
        roles: ["fixer"],
        chemistries: [source.fixerChemistry],
      },
    ]);
    for (const field of LEGACY_DEVELOPMENT_SUMMARY_FIELDS) expect(migrated).not.toHaveProperty(field);
  });

  it("uses Panproto to rewrite repository records in place", async () => {
    const record = {
      uri: `at://did:plc:test/${DEVELOP_SESSION}/session-1`,
      cid: "bafyold",
      value: {
        $type: DEVELOP_SESSION,
        process: "bw",
        chemistry: "at://did:plc:test/app.graycard.instance.chemistry/developer",
        actualTimeSeconds: 600,
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    };
    const applyWrites = vi.fn(async () => ({ results: [] }));
    const client = {
      describe: vi.fn(async () => ({ collections: [DEVELOP_SESSION] })),
      listAll: vi.fn(async () => [record]),
      getLatestCommit: vi.fn(async () => ({ cid: "bafycommit", rev: "1" })),
      applyWrites,
    };

    await expect(migrateDevelopSessionsWithClient(client, "did:plc:test")).resolves.toEqual({
      migrated: true,
      sessions: 1,
    });
    expect(applyWrites).toHaveBeenCalledWith({
      repo: "did:plc:test",
      validate: false,
      swapCommit: "bafycommit",
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#update",
          collection: DEVELOP_SESSION,
          rkey: "session-1",
          value: expect.objectContaining({
            steps: [
              expect.objectContaining({
                kind: "chemical-bath",
                roles: ["film-developer"],
                chemistries: [record.value.chemistry],
              }),
            ],
          }),
        },
      ],
    });
    const written = applyWrites.mock.calls[0][0].writes[0].value;
    expect(written).not.toHaveProperty("chemistry");
    expect(written).not.toHaveProperty("actualTimeSeconds");
  });

  it("cleans legacy fields already nested in process stages", async () => {
    const record = {
      uri: `at://did:plc:test/${DEVELOP_SESSION}/session-2`,
      cid: "bafyold",
      value: {
        $type: DEVELOP_SESSION,
        process: "c41",
        steps: [
          {
            role: "color-developer",
            chemistry: "at://did:plc:test/app.graycard.instance.chemistry/c41",
            temperature: { unit: "celsius", value: 38, scale: 1 },
            timeSeconds: 195,
            agitation: "continuous rotary",
          },
        ],
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    };
    const applyWrites = vi.fn(async () => ({ results: [] }));
    const client = {
      describe: vi.fn(async () => ({ collections: [DEVELOP_SESSION] })),
      listAll: vi.fn(async () => [record]),
      getLatestCommit: vi.fn(async () => ({ cid: "bafycommit", rev: "1" })),
      applyWrites,
    };

    await expect(migrateDevelopSessionsWithClient(client, "did:plc:test")).resolves.toEqual({
      migrated: true,
      sessions: 1,
    });
    expect(applyWrites.mock.calls[0][0].writes[0].value.steps[0]).toEqual({
      name: "Color developer",
      kind: "chemical-bath",
      roles: ["color-developer"],
      chemistries: ["at://did:plc:test/app.graycard.instance.chemistry/c41"],
      actualTemperature: { unit: "celsius", value: 38, scale: 1 },
      actualTimeSeconds: 195,
      agitationScheme: { note: "continuous rotary" },
    });
  });

  it("automatically migrates Aaron's development session while preserving chemistry and lab records", async () => {
    const { fixture, agent, reader } = await aaronFixture();
    const labBefore = await reader.listAll({ repo: REPO, collection: "app.graycard.catalog.lab" });
    const accountBefore = await reader.listAll({ repo: REPO, collection: "app.graycard.instance.labAccount" });
    const chemistryBefore = await reader.listAll({ repo: REPO, collection: "app.graycard.instance.chemistry" });

    await expect(migrateDevelopSessions(agent, REPO)).resolves.toEqual({ migrated: true, sessions: 1 });

    const migrated = await reader.get({ repo: REPO, collection: DEVELOP_SESSION, rkey: "3mt7eva34gy27" });
    expect(migrated.value).not.toHaveProperty("chemistry");
    expect(migrated.value).not.toHaveProperty("dilution");
    expect(migrated.value).not.toHaveProperty("agitation");
    expect(migrated.value).not.toHaveProperty("timeSeconds");
    expect(migrated.value).not.toHaveProperty("actualTimeSeconds");
    expect(migrated.value.steps).toEqual([
      expect.objectContaining({
        name: "Developer",
        kind: "chemical-bath",
        roles: ["film-developer"],
        chemistries: ["at://did:plc:34mbm5v3umztwvvgnttvcz6e/app.graycard.instance.chemistry/3msxgu24uls2c"],
        actualTimeSeconds: 350,
      }),
    ]);
    expect(validateRecord(DEVELOP_SESSION, migrated.value)).toMatchObject({ success: true });
    expect(await reader.listAll({ repo: REPO, collection: "app.graycard.catalog.lab" })).toEqual(labBefore);
    expect(await reader.listAll({ repo: REPO, collection: "app.graycard.instance.labAccount" })).toEqual(accountBefore);
    expect(await reader.listAll({ repo: REPO, collection: "app.graycard.instance.chemistry" })).toEqual(
      chemistryBefore,
    );

    const freshAgent = fixtureAgent(fixture.origin);
    await expect(migrateDevelopSessions(freshAgent, REPO)).resolves.toEqual({ migrated: false, sessions: 0 });
  });

  it("leaves Aaron's source session and related records intact when the repository write fails", async () => {
    const { client, reader } = await aaronFixture();
    const before = await reader.get({ repo: REPO, collection: DEVELOP_SESSION, rkey: "3mt7eva34gy27" });
    vi.spyOn(client, "applyWrites").mockRejectedValueOnce(new Error("simulated PDS failure"));

    await expect(migrateDevelopSessionsWithClient(client, REPO)).rejects.toThrow("simulated PDS failure");

    const after = await reader.get({ repo: REPO, collection: DEVELOP_SESSION, rkey: "3mt7eva34gy27" });
    expect(after).toEqual(before);
    await expect(reader.listAll({ repo: REPO, collection: "app.graycard.catalog.lab" })).resolves.toHaveLength(2);
    await expect(reader.listAll({ repo: REPO, collection: "app.graycard.instance.chemistry" })).resolves.toHaveLength(
      1,
    );
  });
});
