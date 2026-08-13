import { fileURLToPath } from "node:url";
import { createFixturePds } from "./index.js";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const port = Number(args.get("--port") || process.env.FIXTURE_PDS_PORT || 2584);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new TypeError(`Invalid fixture PDS port: ${port}`);
}

const seedPath = fileURLToPath(new URL("./seed.json", import.meta.url));
const versionedRecordsPath = fileURLToPath(new URL("../../fixtures/records/", import.meta.url));
const fixture = await createFixturePds({ port, seedPath, versionedRecordsPath });
process.stdout.write(`Fixture PDS listening on ${fixture.origin}\n`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await fixture.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    close()
      .catch((error) => {
        process.stderr.write(`${error?.stack || error}\n`);
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  });
}
