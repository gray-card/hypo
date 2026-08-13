import { RepoReader } from "./client.js";
import type {
  DescribeRepoInput,
  DescribeRepoOutput,
  GetBlobInput,
  GetInput,
  GetLatestCommitInput,
  GetLatestCommitOutput,
  ListInput,
  ListOutput,
  RecordView,
  RepoReadTransport,
  RepoRecord,
} from "./types.js";

interface XrpcErrorBody {
  error?: unknown;
  message?: unknown;
}

class XrpcFetchError extends Error {
  constructor(
    readonly status: number,
    readonly error: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "XrpcFetchError";
  }
}

export interface XrpcFetchAdapterOptions {
  fetch?: typeof globalThis.fetch;
}

/** Unauthenticated com.atproto.repo/sync query transport for a known PDS. */
export class XrpcFetchAdapter implements RepoReadTransport {
  readonly origin: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(origin: string | URL, options: XrpcFetchAdapterOptions = {}) {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("PDS origin must use http or https");
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    this.origin = url.href.replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listRecords<T extends RepoRecord = RepoRecord>(input: ListInput): Promise<ListOutput<T>> {
    const { signal, ...query } = input;
    return this.getJson<ListOutput<T>>("com.atproto.repo.listRecords", query, signal);
  }

  async describeRepo(input: DescribeRepoInput): Promise<DescribeRepoOutput> {
    const { signal, ...query } = input;
    return this.getJson<DescribeRepoOutput>("com.atproto.repo.describeRepo", query, signal);
  }

  async getRecord<T extends RepoRecord = RepoRecord>(input: GetInput): Promise<RecordView<T>> {
    const { signal, ...query } = input;
    return this.getJson<RecordView<T>>("com.atproto.repo.getRecord", query, signal);
  }

  async getBlob(input: GetBlobInput): Promise<Uint8Array> {
    const { signal, ...query } = input;
    const response = await this.request("com.atproto.sync.getBlob", query, signal);
    return new Uint8Array(await response.arrayBuffer());
  }

  async getLatestCommit(input: GetLatestCommitInput): Promise<GetLatestCommitOutput> {
    const { signal, ...query } = input;
    return this.getJson<GetLatestCommitOutput>("com.atproto.sync.getLatestCommit", query, signal);
  }

  private async getJson<T>(method: string, query: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await this.request(method, query, signal);
    return (await response.json()) as T;
  }

  private async request(method: string, query: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const url = new URL(`${this.origin}/xrpc/${method}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await this.fetch(url, { method: "GET", signal });
    if (response.ok) return response;

    let body: XrpcErrorBody = {};
    try {
      body = (await response.json()) as XrpcErrorBody;
    } catch {
      // Preserve the HTTP status when a proxy returns a non-XRPC error body.
    }
    throw new XrpcFetchError(
      response.status,
      typeof body.error === "string" ? body.error : undefined,
      typeof body.message === "string" ? body.message : `PDS request failed (${response.status})`,
    );
  }
}

export class PublicRepoClient extends RepoReader {
  constructor(origin: string | URL, options: XrpcFetchAdapterOptions = {}) {
    super(new XrpcFetchAdapter(origin, options));
  }
}
