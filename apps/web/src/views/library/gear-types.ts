export type GearValue = Record<string, any>;

export interface GearRecord<Value extends GearValue = GearValue> {
  readonly uri: string;
  readonly value: Value;
  readonly [key: string]: any;
}

export interface GearStore {
  readonly catalog: Readonly<Record<string, readonly GearRecord[] | undefined>>;
  readonly instance: Readonly<Record<string, readonly GearRecord[] | undefined>>;
  readonly maintenanceBySubject?: ReadonlyMap<string, readonly GearRecord[]>;
}

export interface GearPreset {
  readonly primary: string;
  readonly items: readonly GearValue[];
}

export interface GearLocationField {
  readonly node: Node;
  get(): unknown;
}

export interface GearCollections {
  readonly catalog: Readonly<Record<string, string>>;
  readonly instance: Readonly<Record<string, string>>;
  readonly maintenanceSession: string;
}

export interface GearServices {
  readonly collections: GearCollections;
  readonly technicalSchemaKeys: Readonly<Record<string, ReadonlySet<string>>>;
  getStore(): GearStore;
  reloadStore(): Promise<void>;
  saveRecord(collection: string, value: GearValue, existing: GearRecord | null): Promise<string>;
  deleteRecord(uri: string): Promise<void>;
  uploadBlob(file: File, fallbackMime: string): Promise<unknown>;
  catalogImageUrl(typeKind: string, value: GearValue): Promise<string | null | undefined>;
  instanceImageUrl(kind: string, value: GearValue): Promise<string | null | undefined>;
  catalogLabel(kind: string, value: GearValue): string;
  instanceLabel(kind: string, value: GearValue): string;
  kindLabel(kind: string): string;
  kindLabelPlural(kind: string): string;
  enumLabel(value: string): string;
  technicalFieldLabel(key: string): string;
  icon(name: string, size?: number): Node;
  isAdvanced(): boolean;
  inspect(record: GearRecord): void;
  autocomplete(
    wrap: HTMLElement,
    input: HTMLInputElement,
    options: readonly string[] | (() => readonly string[]),
  ): void;
  instanceSelect(kind: string, value?: string): HTMLSelectElement;
  locationField(initial: unknown): GearLocationField;
  lensIssueUrl(fields: GearValue): string;
  getPreset(typeKind: string): GearPreset | null;
  manufacturers(): readonly string[];
  enumOptions(key: string): readonly string[];
  loadCatalogPresets(typeKind: string): Promise<unknown>;
  presetCatalogStatus(typeKind: string): { readonly status: string };
  displayToScaled(value: string | number): number;
  scaledToDisplay(value: number): number;
  displayToShutterScaled(value: string | number): number;
  shutterScaledToDisplay(value: number): string;
  parseScaledList(value: string, convert: (value: string) => number): number[];
  formatScaledList(value: readonly number[], convert: (value: number) => string | number): string;
  displayToMeasure(value: string | number, unit: string): unknown;
  measureToDisplay(value: unknown): string | number;
  confirmDepletedStockpile(existing: GearRecord): Promise<void>;
}

export interface GearFormOptions {
  readonly guided?: boolean;
  readonly onClose?: () => void;
  readonly restoreFocus?: HTMLElement | (() => HTMLElement | null | void);
}

export interface GearInput {
  value: string;
  readonly tagName?: string;
  readonly type?: string;
  readonly options?: HTMLOptionsCollection;
  readonly files?: FileList | null;
  append?(...nodes: Node[]): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export type GearInputMap = Record<string, GearInput>;
