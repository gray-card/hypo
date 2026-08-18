import type {
  ApplyWritesInput,
  ApplyWritesOutput,
  BlobRef,
  CreateInput,
  DeleteInput,
  DeleteOutput,
  DescribeRepoInput,
  DescribeRepoOutput,
  GetBlobInput,
  GetInput,
  GetLatestCommitInput,
  GetLatestCommitOutput,
  ListInput,
  ListOutput,
  PutInput,
  RecordView,
  RepoRecord,
  RepoTransport,
  UploadBlobInput,
  WriteOutput,
} from "./types.js";
import { normalizeBlobRef, normalizeRecordBlobRefs } from "./blob-ref.js";

interface AgentResponse<T> {
  data: T;
}

interface AtprotoAgentLike {
  com: {
    atproto: {
      repo: {
        describeRepo(
          input: Omit<DescribeRepoInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<DescribeRepoOutput>>;
        listRecords(
          input: Omit<ListInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<ListOutput>>;
        getRecord(
          input: Omit<GetInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<RecordView>>;
        createRecord(
          input: Omit<CreateInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<WriteOutput>>;
        putRecord(
          input: Omit<PutInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<WriteOutput>>;
        deleteRecord(
          input: Omit<DeleteInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<DeleteOutput>>;
        applyWrites(
          input: Omit<ApplyWritesInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<ApplyWritesOutput>>;
        uploadBlob(
          bytes: string | Uint8Array | Blob,
          options?: { encoding?: string; signal?: AbortSignal },
        ): Promise<AgentResponse<{ blob: unknown }>>;
      };
      sync: {
        getBlob(
          input: Omit<GetBlobInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<Uint8Array>>;
        getLatestCommit(
          input: Omit<GetLatestCommitInput, "signal">,
          options?: { signal?: AbortSignal },
        ): Promise<AgentResponse<GetLatestCommitOutput>>;
      };
    };
  };
}

function withoutSignal<T extends { signal?: AbortSignal }>(input: T): Omit<T, "signal"> {
  const { signal: _signal, ...rest } = input;
  return rest;
}

/** Isolates the generated @atproto/api method tree and response envelopes. */
export class AtprotoAgentAdapter implements RepoTransport {
  constructor(private readonly agent: AtprotoAgentLike) {}

  async describeRepo(input: DescribeRepoInput): Promise<DescribeRepoOutput> {
    const response = await this.agent.com.atproto.repo.describeRepo(withoutSignal(input), {
      signal: input.signal,
    });
    return response.data;
  }

  async listRecords<T extends RepoRecord = RepoRecord>(input: ListInput): Promise<ListOutput<T>> {
    const response = await this.agent.com.atproto.repo.listRecords(withoutSignal(input), {
      signal: input.signal,
    });
    return response.data as ListOutput<T>;
  }

  async getRecord<T extends RepoRecord = RepoRecord>(input: GetInput): Promise<RecordView<T>> {
    const response = await this.agent.com.atproto.repo.getRecord(withoutSignal(input), {
      signal: input.signal,
    });
    return response.data as RecordView<T>;
  }

  async createRecord<T extends RepoRecord = RepoRecord>(input: CreateInput<T>): Promise<WriteOutput> {
    const response = await this.agent.com.atproto.repo.createRecord(
      { ...withoutSignal(input), record: normalizeRecordBlobRefs(input.record) },
      {
        signal: input.signal,
      },
    );
    return response.data;
  }

  async putRecord<T extends RepoRecord = RepoRecord>(input: PutInput<T>): Promise<WriteOutput> {
    const response = await this.agent.com.atproto.repo.putRecord(
      { ...withoutSignal(input), record: normalizeRecordBlobRefs(input.record) },
      {
        signal: input.signal,
      },
    );
    return response.data;
  }

  async deleteRecord(input: DeleteInput): Promise<DeleteOutput> {
    const response = await this.agent.com.atproto.repo.deleteRecord(withoutSignal(input), {
      signal: input.signal,
    });
    return response.data;
  }

  async applyWrites<T extends RepoRecord = RepoRecord>(input: ApplyWritesInput<T>): Promise<ApplyWritesOutput> {
    const writes = input.writes.map((write) =>
      write.$type === "com.atproto.repo.applyWrites#delete"
        ? write
        : { ...write, value: normalizeRecordBlobRefs(write.value) },
    );
    const response = await this.agent.com.atproto.repo.applyWrites(
      { ...withoutSignal(input), writes },
      {
        signal: input.signal,
      },
    );
    return response.data;
  }

  async uploadBlob(input: UploadBlobInput): Promise<BlobRef> {
    const response = await this.agent.com.atproto.repo.uploadBlob(input.bytes, {
      encoding: input.mimeType ?? "application/octet-stream",
      signal: input.signal,
    });
    return normalizeBlobRef(response.data.blob);
  }

  async getBlob(input: GetBlobInput): Promise<Uint8Array> {
    const response = await this.agent.com.atproto.sync.getBlob(withoutSignal(input), {
      signal: input.signal,
    });
    return response.data;
  }

  async getLatestCommit(input: GetLatestCommitInput): Promise<GetLatestCommitOutput> {
    const response = await this.agent.com.atproto.sync.getLatestCommit(withoutSignal(input), {
      signal: input.signal,
    });
    return response.data;
  }
}
