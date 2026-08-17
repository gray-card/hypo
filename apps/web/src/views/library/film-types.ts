export type FilmValue = Record<string, any>;

export interface FilmRecord<Value extends FilmValue = FilmValue> {
  readonly uri: string;
  readonly value: Value;
  readonly [key: string]: any;
}

export interface FilmStore {
  readonly catalog: Readonly<Record<string, readonly FilmRecord[] | undefined>>;
  readonly instance: Readonly<Record<string, readonly FilmRecord[] | undefined>>;
  readonly byUri?: ReadonlyMap<string, { layer?: string; kind?: string; item: FilmRecord }>;
  readonly photoCaptureByPhoto?: ReadonlyMap<string, FilmRecord>;
  readonly workflowTemplates?: readonly FilmRecord[];
  readonly developSessions?: readonly FilmRecord[];
  readonly digitizeSessions?: readonly FilmRecord[];
}

export interface FilmCollections {
  filmStockpile: string;
  filmRoll: string;
  exposure: string;
  capture: string;
}

export interface FilmViewServices {
  readonly stageLabels?: Readonly<Record<string, string>>;
  readonly collections: FilmCollections;
  getStore(): FilmStore;
  reloadStore(): Promise<void>;
  renderLibrary(): void;
  saveRecord(collection: string, value: FilmValue, existing: FilmRecord | null): Promise<string>;
  uploadBlob(file: File, fallbackMime: string): Promise<unknown>;
  deleteRecord(uri: string): Promise<void>;
  splitRoll(stockpile: FilmRecord, options: { camera: string | null; label: string | null }): Promise<string>;
  instantiateWorkflow?(
    template: FilmRecord,
    subjects: readonly FilmValue[],
    processDefaults?: FilmValue,
    occurrences?: Readonly<Record<string, number>>,
  ): Promise<unknown>;
  advanceWorkflowStage?(kind: string, subjectUris: readonly string[], sessionUri?: string): Promise<number>;
  addGear(kind: "filmStockpile" | "filmRoll", onDone: () => void, prefill?: FilmValue): void;
  editGear(kind: "filmStockpile" | "filmRoll", item: FilmRecord, onDone: () => void): void;
  openRoll(roll: FilmRecord): void;
  openCompletedDevelopment?(roll: FilmRecord, onDone: () => void): void;
  editDevelopment?(session: FilmRecord, onDone: () => void): void;
  openScanSession?(roll: FilmRecord, onDone: () => void): void;
  instanceSelect(kind: string, value?: string): HTMLSelectElement;
  instanceThumb(kind: "filmStockpile" | "filmRoll", value: FilmValue): Node;
  instanceLabel(kind: string, value: FilmValue): string;
  catalogLabel(kind: string, value: FilmValue): string;
  enumLabel(value: string): string;
  icon(name: string, size?: number): Node;
  isAdvanced(): boolean;
  inspect(record: FilmRecord): void;
  matchGear(exif: FilmValue): FilmValue;
  getPhotos(): Promise<readonly FilmRecord[]>;
  blobUrl(blob: unknown): Promise<string | null | undefined>;
  readonly rollStatuses: readonly string[];
  readonly cassetteTypes: readonly string[];
  readonly captureFormats: readonly string[];
}
