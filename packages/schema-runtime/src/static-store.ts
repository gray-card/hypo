export class StaticPanprotoStoreError extends Error {
  readonly name = "StaticPanprotoStoreError";

  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface PanprotoStoreResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type PanprotoStoreFetch = (url: string) => Promise<PanprotoStoreResponse>;

const OBJECT_ID = /^[a-f0-9]{64}$/;
const REF_SEGMENT = /^[A-Za-z0-9._-]+$/;

function checkedObjectId(value: string): string {
  const objectId = value.trim().toLowerCase();
  if (!OBJECT_ID.test(objectId)) throw new StaticPanprotoStoreError(`Invalid Panproto object id: ${value}`);
  return objectId;
}

function checkedRef(value: string): string {
  const segments = value.split("/");
  if (
    !segments.length ||
    segments.some((segment) => !REF_SEGMENT.test(segment) || segment === "." || segment === "..")
  ) {
    throw new StaticPanprotoStoreError(`Invalid Panproto ref: ${value}`);
  }
  return segments.map(encodeURIComponent).join("/");
}

/** Read-only client for the content-addressed store published with the app. */
export class StaticPanprotoStore {
  private readonly baseUrl: string;
  private readonly fetch: PanprotoStoreFetch;

  constructor(options: { readonly baseUrl?: string; readonly fetch?: PanprotoStoreFetch } = {}) {
    this.baseUrl = (options.baseUrl ?? "/.panproto").replace(/\/$/, "");
    this.fetch = options.fetch ?? (globalThis.fetch as PanprotoStoreFetch);
    if (!this.fetch) throw new StaticPanprotoStoreError("No fetch implementation is available");
  }

  async getRef(ref: string): Promise<string> {
    const response = await this.fetch(`${this.baseUrl}/refs/${checkedRef(ref)}`);
    if (!response.ok) throw new StaticPanprotoStoreError(`Unable to fetch Panproto ref ${ref}`, response.status);
    return checkedObjectId(await response.text());
  }

  async getObject(objectId: string): Promise<Uint8Array> {
    const id = checkedObjectId(objectId);
    const response = await this.fetch(`${this.baseUrl}/objects/${id.slice(0, 2)}/${id.slice(2)}`);
    if (!response.ok) throw new StaticPanprotoStoreError(`Unable to fetch Panproto object ${id}`, response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  async resolveRef(ref: string): Promise<{ readonly objectId: string; readonly bytes: Uint8Array }> {
    const objectId = await this.getRef(ref);
    return { objectId, bytes: await this.getObject(objectId) };
  }
}
