export type LoggerValue = Record<string, any>;

export interface LoggerMeasure {
  value?: number;
  scale?: number;
  unit?: string;
}

export interface LoggerReadingReciprocity {
  applied?: boolean;
  model?: string;
  meteredSeconds?: LoggerMeasure;
  filmStock?: string;
}

export type LoggerMeterReadingValue = LoggerValue & {
  ev100?: LoggerMeasure;
  shutterSeconds?: LoggerMeasure;
  reciprocity?: LoggerReadingReciprocity;
  subject?: string;
  takenAt?: string;
  createdAt?: string;
};

export interface LoggerRecord<Value extends LoggerValue = LoggerValue> {
  readonly uri: string;
  readonly value: Value;
  readonly [key: string]: any;
}

export interface LoggerPendingWrite {
  readonly id?: string;
  readonly tempUri?: string;
  readonly record: LoggerValue;
}

export type LoggerGearKind = "camera" | "lens" | "filter" | "filmRoll";
export type LoggerGear = Readonly<Record<LoggerGearKind, readonly LoggerRecord[]>>;

export interface LoggerStore {
  readonly catalog: Readonly<Record<string, readonly LoggerRecord[] | undefined>>;
  readonly instance: Readonly<Record<string, readonly LoggerRecord[] | undefined>>;
}

export interface ShotLoggerState {
  quick: boolean;
  camera: string | null;
  lens: string | null;
  filter: string | null;
  roll: string | null;
  lastFrame: number | null;
  aperture: string | null;
  shutter: string | null;
  ev: string;
  apertureStopFraction: string;
  shutterStopFraction: string;
  metering: string;
  flash: boolean;
  gps: boolean;
  note: string;
}

export type StickyShotLoggerState = Partial<Omit<ShotLoggerState, "lastFrame" | "gps" | "note">>;

export interface ShotLoggerDependencies {
  shoot: LoggerRecord;
  store: LoggerStore;
  gear: LoggerGear;
  sticky?: StickyShotLoggerState;
  persistSticky(state: ShotLoggerState): void;
  framesForRoll(rollUri: string): readonly LoggerRecord[];
  pendingExposures(): readonly LoggerPendingWrite[];
  subscribePendingAcknowledgements?(listener: () => void | Promise<void>): () => void;
  pendingMeterReadingCount(): number;
  enqueueExposure(record: LoggerValue): void;
  flush(): Promise<{ readonly sent?: number }>;
  isOnline(): boolean;
  reloadStore(): Promise<LoggerStore>;
  onStoreReloaded(store: LoggerStore): void;
  onClose?(): void;
  loadMeterReadings(): Promise<readonly LoggerRecord[]>;
  instanceLabel(kind: LoggerGearKind, value: LoggerValue): string;
  filmStockLabel(stockUri: string | undefined): string;
  enumLabel(value: string): string;
  meteringModes: readonly string[];
  icon(name: string, size?: number): Node;
  stopFractions: readonly string[];
  buildApertureOptions(lensType: LoggerValue | undefined, fraction: string): string[];
  buildShutterOptions(cameraType: LoggerValue | undefined, fraction: string): string[];
  usesExactApertureSteps(lensType: LoggerValue | undefined): boolean;
  usesExactShutterSteps(cameraType: LoggerValue | undefined): boolean;
}

export interface ShotLoggerController {
  readonly overlay: HTMLDivElement;
  readonly state: ShotLoggerState;
  close(): void;
  logExposure(sameFrame?: boolean): LoggerValue;
}
