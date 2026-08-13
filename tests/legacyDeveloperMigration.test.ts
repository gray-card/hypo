import { readFileSync } from "node:fs";

import { AtprotoAgentAdapter, PublicRepoClient, RepoClient } from "@hypo/pds";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHEMISTRY_INSTANCE,
  CHEMISTRY_TYPE,
  LEGACY_DEVELOPER_INSTANCE,
  LEGACY_DEVELOPER_TYPE,
  migrateLegacyDeveloperRecordsWithClient,
} from "../src/legacyDeveloperMigration.ts";
import { createFixturePds } from "./fixture-pds/index.js";

const fixtureDocument = JSON.parse(readFileSync("fixtures/migrations/bradwenner-developers.json", "utf8"));
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

describe("legacy developer migration", () => {
  const fixtures: Array<Awaited<ReturnType<typeof createFixturePds>>> = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  });

  async function bradFixture(extraRecords: unknown[] = []) {
    const fixture = await createFixturePds({
      seed: { records: [...fixtureDocument.records, ...extraRecords] },
      versionedRecordsPath: false,
    });
    fixtures.push(fixture);
    const agent = fixtureAgent(fixture.origin);
    const client = new RepoClient(new AtprotoAgentAdapter(agent as never));
    return { fixture, agent, client, reader: new PublicRepoClient(fixture.origin) };
  }

  it("uses Brad's records to atomically replace every developer record and update the workflow", async () => {
    const { client, reader } = await bradFixture();
    const apply = vi.spyOn(client, "applyWrites");

    const result = await migrateLegacyDeveloperRecordsWithClient(client, REPO);

    expect(result).toEqual({
      migrated: true,
      chemistryTypes: 2,
      chemistryInstances: 2,
      workflows: 1,
      dependents: 1,
      deletedLegacyRecords: 4,
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].writes).toHaveLength(9);
    expect(apply.mock.calls[0][0].writes.slice(-4).map((write) => write.$type)).toEqual([
      "com.atproto.repo.applyWrites#delete",
      "com.atproto.repo.applyWrites#delete",
      "com.atproto.repo.applyWrites#delete",
      "com.atproto.repo.applyWrites#delete",
    ]);

    expect(await reader.listAll({ repo: REPO, collection: LEGACY_DEVELOPER_TYPE })).toEqual([]);
    expect(await reader.listAll({ repo: REPO, collection: LEGACY_DEVELOPER_INSTANCE })).toEqual([]);

    const chemistryTypes = await reader.listAll({ repo: REPO, collection: CHEMISTRY_TYPE });
    expect(chemistryTypes).toHaveLength(2);
    const hc110 = chemistryTypes.find((record) => record.value.name === "HC-110");
    expect(hc110?.uri).toContain(`/${CHEMISTRY_TYPE}/3mswqxnp6oc2o`);
    expect(hc110?.value).toMatchObject({
      $type: CHEMISTRY_TYPE,
      roles: ["film-developer"],
      datasheet: {
        url: "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      },
    });

    const chemistry = await reader.listAll({ repo: REPO, collection: CHEMISTRY_INSTANCE });
    expect(chemistry).toHaveLength(2);
    expect(chemistry.find((record) => record.uri.endsWith("/3mswqxnqwdk2o"))?.value).toMatchObject({
      $type: CHEMISTRY_INSTANCE,
      type: `at://${REPO}/${CHEMISTRY_TYPE}/3mswqxnp6oc2o`,
    });

    const workflow = await reader.get({
      repo: REPO,
      collection: "app.graycard.workflow.template",
      rkey: "3mswr2lc6jc2o",
    });
    expect(workflow.value).not.toHaveProperty("defaultDeveloper");
    expect(workflow.value).toMatchObject({
      defaultChemistry: `at://${REPO}/${CHEMISTRY_INSTANCE}/3mswqxnqwdk2o`,
      stageDefaults: expect.arrayContaining([
        expect.objectContaining({
          kind: "develop",
          fields: { chemistry: `at://${REPO}/${CHEMISTRY_INSTANCE}/3mswqxnqwdk2o` },
        }),
      ]),
    });

    await expect(migrateLegacyDeveloperRecordsWithClient(client, REPO)).resolves.toMatchObject({ migrated: false });
  });

  it("rewrites legacy recipe and development-session semantics in the same batch", async () => {
    const oldType = `at://${REPO}/${LEGACY_DEVELOPER_TYPE}/3mswqxnp6oc2o`;
    const oldInstance = `at://${REPO}/${LEGACY_DEVELOPER_INSTANCE}/3mswqxnqwdk2o`;
    const { client, reader } = await bradFixture([
      {
        repo: REPO,
        collection: "app.graycard.catalog.devRecipe",
        rkey: "recipe",
        value: {
          $type: "app.graycard.catalog.devRecipe",
          developerType: oldType,
          developerMake: "Kodak",
          developerName: "HC-110",
          filmMake: "Kodak",
          filmName: "Tri-X",
          process: "bw",
          temps: [{ tempC10: 200, timeSec: 420 }],
          source: "user",
          createdAt: "2026-08-13T05:00:00.000Z",
        },
      },
      {
        repo: REPO,
        collection: "app.graycard.process.developSession",
        rkey: "session",
        value: {
          $type: "app.graycard.process.developSession",
          process: "bw",
          developer: oldInstance,
          steps: [{ role: "film-developer", chemistry: oldInstance }],
          createdAt: "2026-08-13T05:00:00.000Z",
        },
      },
    ]);

    const result = await migrateLegacyDeveloperRecordsWithClient(client, REPO);
    expect(result.dependents).toBe(3);

    const recipe = await reader.get({ repo: REPO, collection: "app.graycard.catalog.devRecipe", rkey: "recipe" });
    expect(recipe.value).not.toHaveProperty("developerType");
    expect(recipe.value).toHaveProperty("chemistryType", `at://${REPO}/${CHEMISTRY_TYPE}/3mswqxnp6oc2o`);

    const session = await reader.get({
      repo: REPO,
      collection: "app.graycard.process.developSession",
      rkey: "session",
    });
    expect(session.value).not.toHaveProperty("developer");
    expect(session.value).toMatchObject({
      chemistry: `at://${REPO}/${CHEMISTRY_INSTANCE}/3mswqxnqwdk2o`,
      steps: [
        {
          roles: ["film-developer"],
          chemistry: `at://${REPO}/${CHEMISTRY_INSTANCE}/3mswqxnqwdk2o`,
        },
      ],
    });
  });

  it("keeps every old record when the atomic repository write fails", async () => {
    const { client, reader } = await bradFixture();
    vi.spyOn(client, "applyWrites").mockRejectedValueOnce(new Error("simulated PDS failure"));

    await expect(migrateLegacyDeveloperRecordsWithClient(client, REPO)).rejects.toThrow("simulated PDS failure");

    expect(await reader.listAll({ repo: REPO, collection: LEGACY_DEVELOPER_TYPE })).toHaveLength(2);
    expect(await reader.listAll({ repo: REPO, collection: LEGACY_DEVELOPER_INSTANCE })).toHaveLength(2);
    expect(await reader.listAll({ repo: REPO, collection: CHEMISTRY_TYPE })).toEqual([]);
    expect(await reader.listAll({ repo: REPO, collection: CHEMISTRY_INSTANCE })).toEqual([]);
    const workflow = await reader.get({
      repo: REPO,
      collection: "app.graycard.workflow.template",
      rkey: "3mswr2lc6jc2o",
    });
    expect(workflow.value).toHaveProperty("defaultDeveloper");
  });

  it("aborts before writing when a chemistry target key already exists", async () => {
    const { client, reader } = await bradFixture([
      {
        repo: REPO,
        collection: CHEMISTRY_TYPE,
        rkey: "3mswqxnp6oc2o",
        value: {
          $type: CHEMISTRY_TYPE,
          name: "Existing chemistry",
          roles: ["fixer"],
          createdAt: "2026-08-13T05:00:00.000Z",
        },
      },
    ]);
    const apply = vi.spyOn(client, "applyWrites");

    await expect(migrateLegacyDeveloperRecordsWithClient(client, REPO)).rejects.toThrow("same key");
    expect(apply).not.toHaveBeenCalled();
    expect(await reader.listAll({ repo: REPO, collection: LEGACY_DEVELOPER_TYPE })).toHaveLength(2);
  });
});
