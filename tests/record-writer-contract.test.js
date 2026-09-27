import { beforeEach, describe, expect, it } from "vitest";
import { RECORD_NSID_LIST, SCHEMAS, validateRecord } from "@hypo/lexicon";
import { deleteRecord, saveRecord } from "../src/graycard.js";
import { WRITTEN_COLLECTIONS } from "../src/oauthScope.js";
import { mockAgent } from "./setup.js";

const DID = "did:plc:test";
const WHEN = "2026-09-27T12:00:00.000Z";
const UPDATED_AT = "2026-09-27T13:00:00.000Z";
const CID = "bafkreifqn5r4ki5vm4w55xd6qhot5gz6b3tvw7athjuwk4vkz6ppf5zo24";
const RETIRED_COLLECTIONS = new Set(["app.graycard.catalog.developerType", "app.graycard.instance.developer"]);

function resolveSchema(ref, currentNsid) {
  const [nsid, fragment = "main"] = ref.startsWith("#") ? [currentNsid, ref.slice(1)] : ref.split("#");
  const schema = SCHEMAS[nsid]?.defs?.[fragment];
  if (!schema) throw new Error(`Unresolved schema fixture reference: ${ref}`);
  return { nsid, schema: schema.type === "record" ? schema.record : schema };
}

function minimumString(schema) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.knownValues?.length) return schema.knownValues[0];
  if (schema.format === "datetime") return WHEN;
  if (schema.format === "at-uri") return `at://${DID}/app.graycard.fixture/record`;
  if (schema.format === "uri") return "https://hypo.graycard.app/fixture";
  const length = Math.max(1, schema.minLength || schema.minGraphemes || 0);
  return "x".repeat(Math.min(length, schema.maxLength || length));
}

function minimumValue(schema, nsid, depth = 0) {
  if (depth > 32) throw new Error(`Schema fixture recursion exceeded for ${nsid}`);
  if (schema.type === "ref") {
    const target = resolveSchema(schema.ref, nsid);
    return minimumValue(target.schema, target.nsid, depth + 1);
  }
  if (schema.type === "union") {
    const target = resolveSchema(schema.refs[0], nsid);
    return minimumValue(target.schema, target.nsid, depth + 1);
  }
  if (schema.type === "object") {
    return Object.fromEntries(
      (schema.required || []).map((key) => [key, minimumValue(schema.properties[key], nsid, depth + 1)]),
    );
  }
  if (schema.type === "array") {
    return Array.from({ length: schema.minLength || 0 }, () => minimumValue(schema.items, nsid, depth + 1));
  }
  if (schema.type === "string") return minimumString(schema);
  if (schema.type === "integer") return Math.max(0, schema.minimum || 0);
  if (schema.type === "boolean") return false;
  if (schema.type === "blob") {
    return { $type: "blob", ref: { $link: CID }, mimeType: schema.accept?.[0] || "application/octet-stream", size: 1 };
  }
  if (schema.type === "cid-link") return { $link: CID };
  if (schema.type === "bytes") return { $bytes: "AA==" };
  if (schema.type === "unknown") return {};
  throw new Error(`No fixture generator for schema type '${schema.type}' in ${nsid}`);
}

function minimumRecord(collection) {
  return minimumValue(SCHEMAS[collection].defs.main.record, collection);
}

function updateRecord(collection, record) {
  const main = SCHEMAS[collection].defs.main.record;
  if (main.type === "object" && main.properties.updatedAt) return { ...record, updatedAt: UPDATED_AT };
  return { ...record };
}

const currentWrittenCollections = WRITTEN_COLLECTIONS.filter((collection) =>
  collection.startsWith("app.graycard."),
).filter((collection) => !RETIRED_COLLECTIONS.has(collection));

beforeEach(() => localStorage.clear());

describe("application record-writer contract", () => {
  it("keeps the declared writer inventory aligned with generated record schemas", () => {
    expect(new Set(currentWrittenCollections).size).toBe(currentWrittenCollections.length);
    expect(currentWrittenCollections.every((collection) => RECORD_NSID_LIST.includes(collection))).toBe(true);
    for (const collection of currentWrittenCollections) {
      expect(SCHEMAS[collection]?.defs?.main?.type, collection).toBe("record");
    }
  });

  it.each(currentWrittenCollections)("round-trips create, update, and delete for %s", async (collection) => {
    const agent = mockAgent();
    const initial = minimumRecord(collection);
    expect(validateRecord(collection, initial), JSON.stringify(initial)).toMatchObject({ success: true });

    const uri = await saveRecord(agent, DID, collection, initial, null);
    expect(uri).toContain(`/${collection}/`);
    expect(agent.created).toHaveLength(1);
    expect(agent.created[0]).toMatchObject({ collection, record: { ...initial, $type: initial.$type || collection } });
    expect(validateRecord(collection, agent.created[0].record)).toMatchObject({ success: true });

    const rkey = uri.split("/").at(-1);
    const updated = updateRecord(collection, agent.created[0].record);
    await saveRecord(agent, DID, collection, updated, {
      uri,
      rkey,
      cid: "cid-created",
      value: agent.created[0].record,
    });
    expect(agent.put).toHaveLength(1);
    expect(agent.put[0]).toMatchObject({ collection, rkey, record: updated });
    expect(validateRecord(collection, agent.put[0].record)).toMatchObject({ success: true });

    await deleteRecord(agent, DID, uri);
    expect(agent.deleted).toEqual([{ collection, rkey }]);
  });
});
