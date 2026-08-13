import type { StickyShotLoggerState, ShotLoggerState } from "./logger-types.ts";

export type ShootValue = Record<string, any>;

export interface ShootRecord<Value extends ShootValue = ShootValue> {
  readonly uri: string;
  readonly value: Value;
  readonly [key: string]: any;
}

export interface ShootPendingWrite {
  readonly id?: string;
  readonly tempUri?: string;
  readonly record: ShootValue;
}

export interface ShootStore {
  readonly catalog: Readonly<Record<string, readonly ShootRecord[] | undefined>>;
  readonly instance: Readonly<Record<string, readonly ShootRecord[] | undefined>>;
  readonly shoots?: readonly ShootRecord[];
  readonly workflowTemplates?: readonly ShootRecord[];
}

export interface ShootCollections {
  readonly capture: string;
  readonly exposure: string;
  readonly meterReading: string;
}

export interface ShootServices {
  readonly stageLabels?: Readonly<Record<string, string>>;
  readonly collections: ShootCollections;
  getStore(): ShootStore;
  reloadStore(): Promise<void>;
  loadStore(): Promise<ShootStore>;
  setStore(store: ShootStore): void;
  saveRecord(collection: string, value: ShootValue, existing: ShootRecord | null): Promise<string>;
  instantiateWorkflow?(
    template: ShootRecord,
    subjects: readonly ShootValue[],
    processDefaults?: ShootValue,
    occurrences?: Readonly<Record<string, number>>,
  ): Promise<unknown>;
  advanceWorkflowStage?(kind: string, subjectUris: readonly string[], sessionUri?: string): Promise<number>;
  deleteRecord(uri: string): Promise<void>;
  pendingExposures(): readonly ShootPendingWrite[];
  subscribePendingAcknowledgements?(listener: () => void | Promise<void>): () => void;
  pendingCount(): number;
  pendingMeterReadingCount(): number;
  enqueueExposure(record: ShootValue): void;
  flushOutbox(): Promise<{ readonly sent?: number }>;
  isOnline(): boolean;
  loadMeterReadings(): Promise<readonly ShootRecord[]>;
  loadSticky(shootUri: string): StickyShotLoggerState | undefined;
  saveSticky(shootUri: string, state: ShotLoggerState): void;
  captureLocation(): Promise<ShootValue>;
  framesForRoll(rollUri: string): readonly ShootRecord[];
  filmStockLabel(stockUri: string | undefined): string;
  instanceLabel(kind: string, value: ShootValue): string;
  kindLabelPlural(kind: string): string;
  enumLabel(value: string): string;
  icon(name: string, size?: number): Node;
  isAdvanced(): boolean;
  inspect(record: ShootRecord): void;
  readonly meteringModes: readonly string[];
  readonly stopFractions: readonly string[];
  buildApertureOptions(lensType: ShootValue | undefined, fraction: string): string[];
  buildShutterOptions(cameraType: ShootValue | undefined, fraction: string): string[];
  usesExactApertureSteps(lensType: ShootValue | undefined): boolean;
  usesExactShutterSteps(cameraType: ShootValue | undefined): boolean;
}

export type ShootGearKind = "camera" | "lens" | "filter" | "filmRoll";
