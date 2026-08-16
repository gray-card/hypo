import { describe, expect, it, vi } from "vitest";

import {
  DEVELOP_SESSION,
  LEGACY_DEVELOPMENT_SUMMARY_FIELDS,
  migrateDevelopSessionsWithClient,
  migrateDevelopSessionValue,
} from "../src/developSessionMigration.ts";

describe("development-session schema migration", () => {
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
});
