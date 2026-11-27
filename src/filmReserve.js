import { TID } from "@atproto/common-web";
import { normalizeRecordView } from "./grain.js";
import { NS, prepareRecordWrite } from "./graycard.js";
import { isOnline } from "./outbox.js";
import { repoClient } from "./pds.js";
import { decodeSchemaRecord, validateSchemaRecordForWrite } from "./schemaRuntime.js";
import { instantiateWorkflowTemplate } from "./workflow.js";

async function readRoll(client, repo, rkey, stockpileUri) {
  try {
    const roll = await client.get({ repo, collection: NS.instance.filmRoll, rkey });
    if (roll.value.stockpile === stockpileUri) return roll.uri;
    throw new Error("This roll identifier is already in use. Close the form and open it again to load a roll.");
  } catch (error) {
    if (error.code === "RecordNotFound") return null;
    throw error;
  }
}

export async function splitRollFromStockpile(
  agent,
  did,
  stockpile,
  { camera, filmBack, label, template, occurrences, rkey = TID.nextStr() } = {},
) {
  if (!isOnline()) throw new Error("Connect to the internet to load a roll from reserve.");

  const client = repoClient(agent);
  const findSavedRoll = () => readRoll(client, did, rkey, stockpile.uri);
  const reserveCollection = NS.instance.filmStockpile;
  let latest;
  let current;
  try {
    // Read the repo commit first so a write between the two reads fails the swap.
    latest = await client.getLatestCommit({ did });
    current = await client.get({ repo: did, collection: reserveCollection, rkey: stockpile.rkey });
    if (current.cid !== stockpile.cid) {
      const savedRoll = await findSavedRoll();
      if (savedRoll) return savedRoll;
      throw new Error("The reserve changed. Close this form, refresh the Library, and try again.");
    }
  } catch (error) {
    if (error.code === "RecordNotFound") {
      const savedRoll = await findSavedRoll();
      if (savedRoll) return savedRoll;
      throw new Error("This film reserve is unavailable. Close this form and refresh the Library.", { cause: error });
    }
    if (error.name === "NetworkError") {
      throw new Error(
        "Could not reach your account’s server to check the film reserve. Check your connection and retry.",
        {
          cause: error,
        },
      );
    }
    if (error.name === "AuthError") {
      throw new Error("Could not check the film reserve. Sign in to Hypo again and retry.", { cause: error });
    }
    throw new Error(`Could not check the film reserve. ${error.message}`, { cause: error });
  }

  const reserve = await decodeSchemaRecord(normalizeRecordView(current), reserveCollection);
  const { stock, quantity, format, expiresAt, emulsionBatch, storage } = reserve.value;
  if (quantity < 1) throw new Error("This film reserve is empty.");

  const now = new Date().toISOString();
  const rollCollection = NS.instance.filmRoll;
  const rollUri = `at://${did}/${rollCollection}/${rkey}`;
  const roll = {
    stock,
    stockpile: reserve.uri,
    status: "loaded",
    loadedAt: now,
    createdAt: now,
    ...(format ? { format } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(emulsionBatch ? { emulsionBatch } : {}),
    ...(storage ? { storage } : {}),
    ...(label ? { label } : {}),
    ...(filmBack ? { filmBack } : camera ? { camera } : {}),
  };

  const writes = [
    {
      $type: "com.atproto.repo.applyWrites#create",
      collection: rollCollection,
      rkey,
      value: await prepareRecordWrite(rollCollection, roll, null),
    },
    {
      $type: "com.atproto.repo.applyWrites#update",
      collection: reserveCollection,
      rkey: stockpile.rkey,
      value: await prepareRecordWrite(
        reserveCollection,
        { ...reserve.value, quantity: quantity - 1, updatedAt: now },
        reserve,
      ),
    },
  ];

  if (template) {
    try {
      await instantiateWorkflowTemplate(agent, did, {
        template,
        subjects: [{ kind: "film-roll-latent", ref: rollUri, ...(label ? { label } : {}) }],
        processDefaults: { filmRoll: rollUri, camera, filmBack },
        occurrences,
        plannedAt: now,
        createRecord: async (collection, record) => {
          if (writes.length >= 200) throw new Error("Choose fewer workflow occurrences to load this roll.");
          const key = TID.nextStr();
          const value = validateSchemaRecordForWrite(collection, await prepareRecordWrite(collection, record, null));
          writes.push({ $type: "com.atproto.repo.applyWrites#create", collection, rkey: key, value });
          return `at://${did}/${collection}/${key}`;
        },
      });
    } catch (error) {
      throw new Error(`Could not prepare the selected workflow. ${error.message}`, { cause: error });
    }
  }

  try {
    await client.applyWrites({ repo: did, writes, validate: false, swapCommit: latest.cid });
  } catch (error) {
    if (error.name === "SwapConflict" || error.name === "NetworkError") {
      // A lost response can mean the whole batch committed. The roll key is
      // stable for the lifetime of the form, including when the user retries.
      const savedRoll = await findSavedRoll().catch(() => null);
      if (savedRoll) return savedRoll;
      if (error.name === "SwapConflict") {
        throw new Error("The repository changed while saving. Try again to check the reserve and load the roll.", {
          cause: error,
        });
      }
      throw new Error("Hypo could not confirm the load. Retry in this form to check whether it was saved.", {
        cause: error,
      });
    }
    if (error.name === "AuthError") {
      throw new Error("Your account’s server refused the load. Sign in to Hypo again and retry.", { cause: error });
    }
    const action = template ? "save the roll, reserve, and selected workflow" : "save the roll and reserve";
    throw new Error(`Could not ${action}. ${error.message}`, { cause: error });
  }
  return rollUri;
}
