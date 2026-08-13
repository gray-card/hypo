import { AtprotoAgentAdapter, RepoClient } from "@hypo/pds";

const clients = new WeakMap();

// Preserve the app's agent-taking APIs while keeping the generated @atproto
// method tree behind the package adapter. One client per session agent also
// keeps validation and future request policy consistent across modules.
export function repoClient(agent) {
  if ((typeof agent !== "object" && typeof agent !== "function") || agent === null) {
    throw new TypeError("An authenticated atproto agent is required");
  }
  let client = clients.get(agent);
  if (!client) {
    client = new RepoClient(new AtprotoAgentAdapter(agent));
    clients.set(agent, client);
  }
  return client;
}
