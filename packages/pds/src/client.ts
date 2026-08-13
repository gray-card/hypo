import { ValidationError, mapPdsError } from "./errors.js";
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
  RecordValidator,
  RecordView,
  RepoReadTransport,
  RepoRecord,
  RepoTransport,
  UploadBlobInput,
  WriteOutput,
} from "./types.js";

// Validators are generated from the full lexicon suite. Load that table only
// when the first write is validated so public/read-only routes carry no schema
// bytes in the entry chunk.
export const generatedRecordValidator: RecordValidator = async (collection, record) => {
  const { validateRecord } = await import("@hypo/lexicon/validators");
  return validateRecord(collection, record);
};

export interface RepoClientOptions {
  validator?: RecordValidator | false;
}

export class RepoReader {
  constructor(protected readonly transport: RepoReadTransport) {}

  async describe(input: DescribeRepoInput): Promise<DescribeRepoOutput> {
    return this.run("describeRepo", () => this.transport.describeRepo(input));
  }

  async list<T extends RepoRecord = RepoRecord>(input: ListInput): Promise<ListOutput<T>> {
    return this.run("list", () => this.transport.listRecords<T>(input));
  }

  async listAll<T extends RepoRecord = RepoRecord>(input: Omit<ListInput, "cursor">): Promise<Array<RecordView<T>>> {
    const records: Array<RecordView<T>> = [];
    let cursor: string | undefined;
    do {
      const page = await this.list<T>({ ...input, cursor });
      records.push(...page.records);
      cursor = page.cursor;
    } while (cursor !== undefined);
    return records;
  }

  async get<T extends RepoRecord = RepoRecord>(input: GetInput): Promise<RecordView<T>> {
    return this.run("get", () => this.transport.getRecord<T>(input));
  }

  async getBlob(input: GetBlobInput): Promise<Uint8Array> {
    return this.run("getBlob", () => this.transport.getBlob(input));
  }

  async getLatestCommit(input: GetLatestCommitInput): Promise<GetLatestCommitOutput> {
    return this.run("getLatestCommit", () => this.transport.getLatestCommit(input));
  }

  protected async run<T>(operation: string, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw mapPdsError(error, operation);
    }
  }
}

export class RepoClient extends RepoReader {
  readonly validator: RecordValidator | false;

  constructor(
    protected override readonly transport: RepoTransport,
    options: RepoClientOptions = {},
  ) {
    super(transport);
    this.validator = options.validator === undefined ? generatedRecordValidator : options.validator;
  }

  async create<T extends RepoRecord = RepoRecord>(input: CreateInput<T>): Promise<WriteOutput> {
    await this.validate(input.collection, input.record, input.validate);
    return this.run("create", () => this.transport.createRecord(input));
  }

  async put<T extends RepoRecord = RepoRecord>(input: PutInput<T>): Promise<WriteOutput> {
    await this.validate(input.collection, input.record, input.validate);
    try {
      return await this.transport.putRecord(input);
    } catch (error) {
      throw mapPdsError(error, "put", { expectedCid: input.swapRecord ?? undefined });
    }
  }

  async delete(input: DeleteInput): Promise<DeleteOutput> {
    try {
      return await this.transport.deleteRecord(input);
    } catch (error) {
      throw mapPdsError(error, "delete", { expectedCid: input.swapRecord });
    }
  }

  async applyWrites<T extends RepoRecord = RepoRecord>(input: ApplyWritesInput<T>): Promise<ApplyWritesOutput> {
    for (const write of input.writes) {
      if (write.$type === "com.atproto.repo.applyWrites#delete") continue;
      // applyWrites.validate controls validation at the PDS. Hypo still validates
      // known records locally even when a custom lexicon requires validate:false
      // on a PDS that has not installed that lexicon.
      await this.validate(write.collection, write.value, undefined);
    }
    try {
      return await this.transport.applyWrites(input);
    } catch (error) {
      throw mapPdsError(error, "applyWrites", { expectedCid: input.swapCommit });
    }
  }

  async uploadBlob(input: UploadBlobInput): Promise<BlobRef> {
    return this.run("uploadBlob", () => this.transport.uploadBlob(input));
  }

  private async validate(collection: string, record: RepoRecord, enabled: boolean | undefined): Promise<void> {
    if (enabled === false || this.validator === false) return;
    const result = await this.validator(collection, record);
    if (!result.success) {
      throw new ValidationError(`Record does not satisfy ${collection}`, {
        code: "ValidationError",
        operation: "validate",
        issues: result.issues,
      });
    }
  }
}
