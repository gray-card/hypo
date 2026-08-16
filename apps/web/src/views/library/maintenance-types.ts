export type LibraryValue = Record<string, any>;

export interface LibraryRecord<Value extends LibraryValue = LibraryValue> {
  readonly uri: string;
  readonly value: Value;
  readonly [key: string]: any;
}

export interface LibraryStore {
  readonly catalog: Readonly<Record<string, readonly LibraryRecord[] | undefined>>;
  readonly instance: Readonly<Record<string, readonly LibraryRecord[] | undefined>>;
  readonly byUri: ReadonlyMap<string, { layer: string; kind: string; item: LibraryRecord }>;
  readonly workflowTemplates?: readonly LibraryRecord[];
  readonly workflowRuns?: readonly LibraryRecord[];
  readonly workflowStages?: readonly LibraryRecord[];
  readonly developSessions?: readonly LibraryRecord[];
  readonly digitizeSessions?: readonly LibraryRecord[];
  readonly processSessions?: readonly LibraryRecord[];
  readonly batchRules: readonly LibraryRecord[];
  readonly photoCaptureByPhoto: ReadonlyMap<string, LibraryRecord>;
  readonly shoots?: readonly LibraryRecord[];
}

export interface ActivityCollections {
  readonly workflowTemplate: string;
  readonly developSession: string;
  readonly filmRoll: string;
  readonly chemistry: string;
  readonly digitizeSession: string;
  readonly exposure: string;
}

export interface LintFinding {
  readonly title: string;
  readonly detail: string;
  readonly severity: string;
  readonly count: number;
}

export interface ActivityServices {
  readonly collections: ActivityCollections;
  readonly stageLabels: Readonly<Record<string, string>>;
  readonly mediums: readonly string[];
  getStore(): LibraryStore;
  reloadStore(): Promise<void>;
  saveRecord(collection: string, value: LibraryValue, existing: LibraryRecord | null): Promise<string>;
  deleteRecord(uri: string): Promise<void>;
  saveWorkflowTemplate(value: LibraryValue, existing: LibraryRecord | null): Promise<string>;
  instanceLabel(kind: string, value: LibraryValue | undefined): string;
  catalogLabel(kind: string, value: LibraryValue): string;
  chemistryRoles(value: LibraryValue): readonly string[];
  enumLabel(value: string): string;
  kindLabelPlural(kind: string): string;
  icon(name: string, size?: number): Node;
  isAdvanced(): boolean;
  inspect(record: LibraryRecord): void;
  activeDevelopment(): { readonly film?: string } | null;
  openDevelopmentTimer(options: LibraryValue): Promise<unknown>;
  advanceWorkflowStage?(kind: string, subjectUris: readonly string[], sessionUri: string): Promise<number>;
  workflowActions?(run: LibraryRecord): readonly LibraryRecord[];
  openWorkflowStageLogger?(run: LibraryRecord, stage: LibraryRecord, onDone: () => void): void;
  skipWorkflowStage?(run: LibraryRecord, stage: LibraryRecord, onDone: () => void): Promise<void>;
  cancelWorkflowRun?(run: LibraryRecord, onDone: () => void): Promise<void>;
  capturePhotos(): Promise<readonly LibraryRecord[]>;
  blobUrl(blob: unknown): Promise<string | null | undefined>;
  computeLintFindings(): readonly LintFinding[];
  reserveQuantity(value: LibraryValue): number;
  filmStockLabel(stockUri: string | undefined): string;
}
