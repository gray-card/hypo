export type RepoRecord = Record<string, unknown>;

export interface RecordView<T extends RepoRecord = RepoRecord> {
  uri: string;
  cid?: string;
  value: T;
}

export interface ListInput {
  repo: string;
  collection: string;
  limit?: number;
  cursor?: string;
  reverse?: boolean;
  signal?: AbortSignal;
}

export interface ListOutput<T extends RepoRecord = RepoRecord> {
  records: Array<RecordView<T>>;
  cursor?: string;
}

export interface GetInput {
  repo: string;
  collection: string;
  rkey: string;
  cid?: string;
  signal?: AbortSignal;
}

export interface DescribeRepoInput {
  repo: string;
  signal?: AbortSignal;
}

export interface DescribeRepoOutput {
  collections: string[];
  did?: string;
  handle?: string;
  didDoc?: unknown;
}

export interface CreateInput<T extends RepoRecord = RepoRecord> {
  repo: string;
  collection: string;
  record: T;
  rkey?: string;
  validate?: boolean;
  swapCommit?: string;
  signal?: AbortSignal;
}

export interface PutInput<T extends RepoRecord = RepoRecord> {
  repo: string;
  collection: string;
  rkey: string;
  record: T;
  validate?: boolean;
  swapRecord?: string | null;
  swapCommit?: string;
  signal?: AbortSignal;
}

export interface DeleteInput {
  repo: string;
  collection: string;
  rkey: string;
  swapRecord?: string;
  swapCommit?: string;
  signal?: AbortSignal;
}

export interface WriteOutput {
  uri: string;
  cid: string;
  commit?: unknown;
  validationStatus?: string;
}

export interface DeleteOutput {
  commit?: unknown;
}

export interface ApplyCreate<T extends RepoRecord = RepoRecord> {
  $type: "com.atproto.repo.applyWrites#create";
  collection: string;
  rkey?: string;
  value: T;
}

export interface ApplyUpdate<T extends RepoRecord = RepoRecord> {
  $type: "com.atproto.repo.applyWrites#update";
  collection: string;
  rkey: string;
  value: T;
}

export interface ApplyDelete {
  $type: "com.atproto.repo.applyWrites#delete";
  collection: string;
  rkey: string;
}

export type ApplyWrite<T extends RepoRecord = RepoRecord> = ApplyCreate<T> | ApplyUpdate<T> | ApplyDelete;

export interface ApplyWritesInput<T extends RepoRecord = RepoRecord> {
  repo: string;
  writes: Array<ApplyWrite<T>>;
  validate?: boolean;
  swapCommit?: string;
  signal?: AbortSignal;
}

export interface ApplyCreateResult {
  $type?: "com.atproto.repo.applyWrites#createResult";
  uri: string;
  cid: string;
  validationStatus?: string;
}

export interface ApplyUpdateResult {
  $type?: "com.atproto.repo.applyWrites#updateResult";
  uri: string;
  cid: string;
  validationStatus?: string;
}

export interface ApplyDeleteResult {
  $type?: "com.atproto.repo.applyWrites#deleteResult";
}

export type ApplyWriteResult = ApplyCreateResult | ApplyUpdateResult | ApplyDeleteResult;

export interface RepoCommit {
  cid: string;
  rev: string;
}

export interface ApplyWritesOutput {
  commit?: RepoCommit;
  results?: ApplyWriteResult[];
}

export interface BlobRef {
  $type?: string;
  ref: unknown;
  mimeType: string;
  size: number;
}

export interface UploadBlobInput {
  bytes: string | Uint8Array | Blob;
  mimeType?: string;
  signal?: AbortSignal;
}

export interface GetBlobInput {
  did: string;
  cid: string;
  signal?: AbortSignal;
}

export interface GetLatestCommitInput {
  did: string;
  signal?: AbortSignal;
}

export interface GetLatestCommitOutput {
  cid: string;
  rev: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type RecordValidationResult<T extends RepoRecord = RepoRecord> =
  { success: true; data?: T } | { success: false; issues: readonly ValidationIssue[] };

export type RecordValidator = (
  collection: string,
  record: RepoRecord,
) => RecordValidationResult | Promise<RecordValidationResult>;

export interface RepoReadTransport {
  describeRepo(input: DescribeRepoInput): Promise<DescribeRepoOutput>;
  listRecords<T extends RepoRecord = RepoRecord>(input: ListInput): Promise<ListOutput<T>>;
  getRecord<T extends RepoRecord = RepoRecord>(input: GetInput): Promise<RecordView<T>>;
  getBlob(input: GetBlobInput): Promise<Uint8Array>;
  getLatestCommit(input: GetLatestCommitInput): Promise<GetLatestCommitOutput>;
}

export interface RepoTransport extends RepoReadTransport {
  createRecord<T extends RepoRecord = RepoRecord>(input: CreateInput<T>): Promise<WriteOutput>;
  putRecord<T extends RepoRecord = RepoRecord>(input: PutInput<T>): Promise<WriteOutput>;
  deleteRecord(input: DeleteInput): Promise<DeleteOutput>;
  applyWrites<T extends RepoRecord = RepoRecord>(input: ApplyWritesInput<T>): Promise<ApplyWritesOutput>;
  uploadBlob(input: UploadBlobInput): Promise<BlobRef>;
}
