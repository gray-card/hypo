import { $ } from "@hypo/ui";
import { createSessionAgent, loadBrowserOAuthClient } from "@hypo/pds/session";

const CLIENT_METADATA_URL = "https://hypo.graycard.app/client-metadata.json";
const HANDLE_RESOLVER = "https://bsky.social";
const TYPEAHEAD_ENDPOINT = "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead";
const E2E_SCOPE = "repo:* e2e";
const CALLBACK_PARAMETERS = ["code", "state", "iss", "error", "error_description"];

interface OAuthSession {
  did: string;
  signOut?: () => Promise<unknown>;
}

interface OAuthClient {
  init(): Promise<{ session?: OAuthSession }>;
  signIn(handle: string, options: { scope: string }): Promise<unknown>;
  revoke?(did: string): Promise<unknown>;
}

interface E2ERuntime {
  oauthClient: OAuthClient;
  agent: unknown;
}

interface E2EOptions {
  enabled: boolean;
  pdsOrigin?: string;
  loadRuntime(pdsOrigin: string): Promise<E2ERuntime>;
}

interface LocationLike {
  hostname: string;
  href: string;
  origin: string;
  reload(): void;
}

interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface AuthenticatedSession {
  agent: unknown;
  did: string;
  session: OAuthSession;
}

export interface SessionControllerOptions {
  loadScope(): Promise<string>;
  onAuthenticated(context: AuthenticatedSession): void | Promise<void>;
  onLoggedOut(): void | Promise<void>;
  e2e?: E2EOptions;
  clientMetadataUrl?: string;
  handleResolver?: string;
  typeaheadEndpoint?: string;
  location?: LocationLike;
  history?: HistoryLike;
  fetch?: typeof globalThis.fetch;
  createAgent?: (session: OAuthSession) => Promise<unknown>;
  loadBrowserClient?: (options: { clientId: string; handleResolver: string }) => Promise<OAuthClient>;
  logger?: Pick<Console, "warn">;
  autocompleteDelayMs?: number;
}

/** Return the path/search/hash with stale OAuth callback parameters removed. */
export function stripOAuthCallbackParams(href: string): string | null {
  try {
    const url = new URL(href);
    let touched = false;
    for (const key of CALLBACK_PARAMETERS) {
      if (!url.searchParams.has(key)) continue;
      url.searchParams.delete(key);
      touched = true;
    }
    return touched ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

function loopbackClientId(location: LocationLike, scope: string): string {
  return (
    "http://localhost" +
    `?redirect_uri=${encodeURIComponent(`${location.origin}/`)}` +
    `&scope=${encodeURIComponent(scope)}`
  );
}

function installHandleAutocomplete(endpoint: string, fetchImpl: typeof globalThis.fetch, delayMs: number): void {
  const input = $("#handle") as HTMLInputElement | null;
  const list = $("#handle-suggestions") as HTMLUListElement | null;
  if (!input || !list) return;

  let items: Array<string | { handle: string }> = [];
  let index = -1;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;

  const nameOf = (item: string | { handle: string }) => (typeof item === "string" ? item : item.handle);
  const hide = () => {
    list.classList.add("hidden");
    list.replaceChildren();
    index = -1;
    items = [];
  };
  const choose = (itemIndex: number) => {
    const item = items[itemIndex];
    if (!item) return;
    input.value = nameOf(item);
    hide();
  };
  const render = () => {
    list.replaceChildren(
      ...items.map((item, itemIndex) => {
        const option = document.createElement("li");
        option.className = "handle-option" + (itemIndex === index ? " active" : "");
        option.textContent = nameOf(item);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => choose(itemIndex));
        return option;
      }),
    );
    list.classList.toggle("hidden", !items.length);
  };

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const query = input.value.trim();
      if (query.length < 2) {
        hide();
        return;
      }
      abort?.abort();
      abort = new AbortController();
      try {
        const response = await fetchImpl(`${endpoint}?q=${encodeURIComponent(query)}&limit=8`, {
          signal: abort.signal,
        });
        const payload = (await response.json()) as { actors?: Array<string | { handle: string }> };
        items = payload.actors || [];
        index = -1;
        render();
      } catch {
        // An aborted or offline lookup leaves the current input untouched.
      }
    }, delayMs);
  });

  input.addEventListener("keydown", (event) => {
    if (list.classList.contains("hidden") || !items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      index = (index + 1) % items.length;
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      index = (index - 1 + items.length) % items.length;
      render();
    } else if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      choose(index);
    } else if (event.key === "Escape") {
      hide();
    }
  });
}

/** Own the OAuth client, restored session, and login controls at the PDS/app boundary. */
export function createSessionController(options: SessionControllerOptions) {
  const browserLocation = options.location || window.location;
  const browserHistory = options.history || window.history;
  const fetchImpl = options.fetch || globalThis.fetch;
  const logger = options.logger || console;
  const makeAgent = options.createAgent || ((session: OAuthSession) => createSessionAgent(session));
  const loadClient =
    options.loadBrowserClient ||
    ((clientOptions: { clientId: string; handleResolver: string }) =>
      loadBrowserOAuthClient(clientOptions) as unknown as Promise<OAuthClient>);

  let scope = "";
  let oauthClient: OAuthClient | null = null;
  let session: OAuthSession | null = null;
  let did: string | null = null;

  const clearOAuthCallbackParams = () => {
    const next = stripOAuthCallbackParams(browserLocation.href);
    if (next) browserHistory.replaceState(null, "", next);
  };

  const acceptSession = async (nextSession: OAuthSession, injectedAgent?: unknown) => {
    session = nextSession;
    did = nextSession.did;
    const agent = injectedAgent || (await makeAgent(nextSession));
    await options.onAuthenticated({ agent, did: nextSession.did, session: nextSession });
  };

  const bootstrap = async () => {
    if (browserLocation.hostname === "localhost") {
      browserLocation.href = browserLocation.href.replace("localhost", "127.0.0.1");
      return;
    }

    const e2e = options.e2e;
    if (e2e?.enabled && e2e.pdsOrigin) {
      const runtime = await e2e.loadRuntime(e2e.pdsOrigin);
      scope = E2E_SCOPE;
      oauthClient = runtime.oauthClient;
      const result = await oauthClient.init();
      if (result.session) await acceptSession(result.session, runtime.agent);
      else await options.onLoggedOut();
      return;
    }

    scope = await options.loadScope();
    oauthClient = await loadClient({
      clientId:
        browserLocation.hostname === "127.0.0.1"
          ? loopbackClientId(browserLocation, scope)
          : options.clientMetadataUrl || CLIENT_METADATA_URL,
      handleResolver: options.handleResolver || HANDLE_RESOLVER,
    });

    let result: { session?: OAuthSession };
    try {
      result = await oauthClient.init();
    } catch (error) {
      clearOAuthCallbackParams();
      logger.warn("OAuth init could not resume a session:", error instanceof Error ? error.message : error);
      await options.onLoggedOut();
      return;
    }
    if (result.session) await acceptSession(result.session);
    else await options.onLoggedOut();
  };

  const signIn = async (handle: string) => {
    if (!oauthClient) throw new Error("OAuth is not ready yet.");
    return oauthClient.signIn(handle, { scope });
  };

  const signOut = async () => {
    try {
      if (session?.signOut) await session.signOut();
      else if (oauthClient?.revoke && did) await oauthClient.revoke(did);
    } catch {
      // Revocation is best-effort; local reload still clears the active view.
    }
    browserLocation.reload();
  };

  const installLoginControls = () => {
    const form = $("#login-form") as HTMLFormElement | null;
    const input = $("#handle") as HTMLInputElement | null;
    const error = $("#login-error") as HTMLElement | null;
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const handle = input?.value.trim() || "";
      if (!handle) return;
      try {
        await signIn(handle);
      } catch (reason) {
        if (error) error.textContent = reason instanceof Error ? reason.message : String(reason);
      }
    });
    installHandleAutocomplete(
      options.typeaheadEndpoint || TYPEAHEAD_ENDPOINT,
      fetchImpl,
      options.autocompleteDelayMs ?? 200,
    );
  };

  return { bootstrap, clearOAuthCallbackParams, installLoginControls, signIn, signOut };
}
