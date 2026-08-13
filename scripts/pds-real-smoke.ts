import assert from "node:assert/strict";
import { TestNetworkNoAppView } from "@atproto/dev-env";
import { AtprotoAgentAdapter, RepoClient, SwapConflict, type BlobRef } from "@hypo/pds";

const COLLECTION = "app.graycard.smoke";
const HANDLE = "hypo-pds-smoke.test";
const EMAIL = "hypo-pds-smoke@example.com";
const PASSWORD = "hypo-pds-smoke-password";

interface SmokeRecord extends Record<string, unknown> {
  $type: typeof COLLECTION;
  stage: "created" | "updated";
  createdAt: string;
  blob?: BlobRef;
}

function cidString(blob: BlobRef): string {
  if (typeof blob.ref === "string") return blob.ref;
  if (typeof blob.ref === "object" && blob.ref !== null && "$link" in blob.ref) {
    const link = (blob.ref as { $link?: unknown }).$link;
    if (typeof link === "string") return link;
  }
  const rendered = String(blob.ref);
  if (rendered && rendered !== "[object Object]") return rendered;
  throw new Error("The PDS returned a blob without a readable CID");
}

function rkeyFromUri(uri: string): string {
  const rkey = uri.split("/").at(-1);
  if (!rkey) throw new Error(`The PDS returned an invalid AT URI: ${uri}`);
  return rkey;
}

async function run(): Promise<void> {
  console.log("Starting an in-process @atproto/dev-env PDS…");
  const network = await TestNetworkNoAppView.create();

  try {
    const agent = network.pds.getAgent();
    const account = await agent.createAccount({ handle: HANDLE, email: EMAIL, password: PASSWORD });
    const repo = account.data.did;
    const client = new RepoClient(new AtprotoAgentAdapter(agent), { validator: false });
    const createdAt = new Date().toISOString();

    console.log("Creating and reading a custom record…");
    const created = await client.create<SmokeRecord>({
      repo,
      collection: COLLECTION,
      record: { $type: COLLECTION, stage: "created", createdAt },
      validate: false,
    });
    const rkey = rkeyFromUri(created.uri);
    const initial = await client.get<SmokeRecord>({ repo, collection: COLLECTION, rkey });
    assert.equal(initial.cid, created.cid);
    assert.equal(initial.value.stage, "created");

    console.log("Uploading a blob…");
    const blobBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x48, 0x59, 0x50, 0x4f, 0xff, 0xd9]);
    const blob = await client.uploadBlob({ bytes: blobBytes, mimeType: "image/jpeg" });
    assert.equal(blob.mimeType, "image/jpeg");
    assert.equal(blob.size, blobBytes.byteLength);

    console.log("Updating with compare-and-swap, persisting the blob reference, and downloading the blob…");
    const updatedRecord: SmokeRecord = { $type: COLLECTION, stage: "updated", createdAt, blob };
    const updated = await client.put<SmokeRecord>({
      repo,
      collection: COLLECTION,
      rkey,
      record: updatedRecord,
      swapRecord: created.cid,
      validate: false,
    });
    assert.notEqual(updated.cid, created.cid);
    const current = await client.get<SmokeRecord>({ repo, collection: COLLECTION, rkey });
    assert.equal(current.cid, updated.cid);
    assert.equal(current.value.stage, "updated");
    await network.processAll();
    const downloaded = await client.getBlob({ did: repo, cid: cidString(blob) });
    assert.deepEqual(downloaded, blobBytes);

    console.log("Verifying stale-swap rejection…");
    await assert.rejects(
      client.put<SmokeRecord>({
        repo,
        collection: COLLECTION,
        rkey,
        record: { ...updatedRecord, staleAttempt: true },
        swapRecord: created.cid,
        validate: false,
      }),
      (error: unknown) => error instanceof SwapConflict && error.expectedCid === created.cid,
    );

    console.log("Deleting with compare-and-swap…");
    await client.delete({ repo, collection: COLLECTION, rkey, swapRecord: updated.cid });
    await assert.rejects(client.get({ repo, collection: COLLECTION, rkey }));

    console.log("Real PDS smoke passed.");
  } finally {
    await network.close();
  }
}

run().catch((error: unknown) => {
  console.error("Real PDS smoke failed:", error);
  process.exitCode = 1;
});
