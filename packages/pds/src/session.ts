export interface BrowserOAuthOptions {
  clientId: string;
  handleResolver: string;
}

/** Keep the OAuth implementation and its bundle behind the session boundary. */
export async function loadBrowserOAuthClient(options: BrowserOAuthOptions) {
  const { BrowserOAuthClient } = await import("@atproto/oauth-client-browser");
  return BrowserOAuthClient.load(options as Parameters<typeof BrowserOAuthClient.load>[0]);
}

/** Construct the generated atproto agent without leaking that dependency into the app shell. */
export async function createSessionAgent(session: unknown) {
  const { Agent } = await import("@atproto/api");
  return new Agent(session as ConstructorParameters<typeof Agent>[0]);
}
