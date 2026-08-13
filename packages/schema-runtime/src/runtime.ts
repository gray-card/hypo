import type { CompiledMigration } from "@panproto/core";

import { complementKey, openComplementStore, type ComplementStore } from "./complements.ts";
import { loadPanproto, type PanprotoEngine, type PanprotoEngineLoader } from "./engine.ts";
import {
  ComplementConflict,
  MissingSchemaTransitionError,
  UnknownSchemaVersionError,
  normalizeComplementError,
} from "./errors.ts";

export type VersionValidator = (
  collection: string,
  value: unknown,
  engine?: PanprotoEngine,
) => boolean | Promise<boolean>;

export interface SchemaVersionDefinition {
  readonly id: string;
  readonly order: number;
  readonly validate: VersionValidator;
}

export interface JsonForwardMigration {
  lift(value: unknown, rootVertex: string): unknown | Promise<unknown>;
}

export interface JsonBackwardLens {
  project(
    newerValue: unknown,
    rootVertex: string,
  ): { view: unknown; complement: Uint8Array } | Promise<{ view: unknown; complement: Uint8Array }>;
  restore(olderView: unknown, complement: Uint8Array, rootVertex: string): unknown | Promise<unknown>;
}

export interface SchemaTransition {
  readonly id: string;
  readonly olderVersion: string;
  readonly newerVersion: string;
  readonly rootVertex: (collection: string) => string;
  readonly forward: JsonForwardMigration;
  /** A lens whose source is the newer schema and whose view is the older schema. */
  readonly backward: JsonBackwardLens;
}

export interface SchemaTransitionDefinition {
  readonly id: string;
  readonly olderVersion: string;
  readonly newerVersion: string;
  readonly load: (engine: PanprotoEngine) => SchemaTransition | Promise<SchemaTransition>;
}

export interface SchemaRuntimeOptions {
  readonly pinnedVersion: string;
  readonly versions: readonly SchemaVersionDefinition[];
  readonly transitions?: readonly SchemaTransitionDefinition[];
  readonly complements: ComplementStore;
  readonly loadEngine?: PanprotoEngineLoader;
  readonly now?: () => number;
}

export interface RecordIdentity {
  readonly recordUri: string;
  readonly cid: string;
  readonly collection: string;
}

export interface DecodedRecord<T = unknown> extends RecordIdentity {
  readonly value: T;
  readonly nativeVersion: string;
  readonly viewVersion: string;
  readonly chainIds: readonly string[];
}

export interface PrepareWriteInput<T = unknown> extends DecodedRecord<T> {
  readonly editedValue: unknown;
}

/**
 * Version detection and per-record migration at the store decode boundary.
 * The pinned validator is synchronous-fast-path friendly; WASM loads only
 * after that validator rejects a record.
 */
export class SchemaRuntime {
  readonly pinnedVersion: string;

  private readonly versions: readonly SchemaVersionDefinition[];
  private readonly versionById: ReadonlyMap<string, SchemaVersionDefinition>;
  private readonly transitionDefinitions: readonly SchemaTransitionDefinition[];
  private readonly transitionCache = new Map<string, Promise<SchemaTransition>>();
  private readonly complements: ComplementStore;
  private readonly loadEngine: PanprotoEngineLoader;
  private readonly now: () => number;
  private enginePromise?: Promise<PanprotoEngine>;

  constructor(options: SchemaRuntimeOptions) {
    this.pinnedVersion = options.pinnedVersion;
    this.versions = [...options.versions].sort((left, right) => left.order - right.order);
    this.versionById = new Map(this.versions.map((version) => [version.id, version]));
    if (!this.versionById.has(this.pinnedVersion)) {
      throw new TypeError(`Pinned schema version ${this.pinnedVersion} is not registered`);
    }
    this.transitionDefinitions = options.transitions ?? [];
    this.complements = options.complements;
    this.loadEngine = options.loadEngine ?? loadPanproto;
    this.now = options.now ?? Date.now;
  }

  async decode<T = unknown>(identity: RecordIdentity, value: unknown): Promise<DecodedRecord<T>> {
    const pinned = this.versionById.get(this.pinnedVersion)!;
    if (await pinned.validate(identity.collection, value)) {
      await this.complements.deleteForUri(identity.recordUri);
      return { ...identity, value: value as T, nativeVersion: pinned.id, viewVersion: pinned.id, chainIds: [] };
    }

    const engine = await this.engine();
    const candidates = [...this.versions].sort((left, right) => right.order - left.order);
    let native: SchemaVersionDefinition | undefined;
    for (const candidate of candidates) {
      if (candidate.id === pinned.id) continue;
      if (await candidate.validate(identity.collection, value, engine)) {
        native = candidate;
        break;
      }
    }
    if (!native)
      throw new UnknownSchemaVersionError(
        identity.collection,
        candidates.map(({ id }) => id),
      );

    await this.complements.deleteForUri(identity.recordUri);
    const nativeIndex = this.versions.findIndex(({ id }) => id === native!.id);
    const pinnedIndex = this.versions.findIndex(({ id }) => id === pinned.id);
    let migrated = value;
    const chainIds: string[] = [];

    if (nativeIndex < pinnedIndex) {
      for (let index = nativeIndex; index < pinnedIndex; index += 1) {
        const transition = await this.transition(this.versions[index].id, this.versions[index + 1].id);
        migrated = await transition.forward.lift(migrated, transition.rootVertex(identity.collection));
        chainIds.push(transition.id);
      }
    } else {
      let projectionOrder = 0;
      for (let index = nativeIndex; index > pinnedIndex; index -= 1) {
        const transition = await this.transition(this.versions[index - 1].id, this.versions[index].id);
        const rootVertex = transition.rootVertex(identity.collection);
        const projected = await transition.backward.project(migrated, rootVertex);
        await this.complements.put({
          key: complementKey(identity.recordUri, identity.cid, transition.id),
          ...identity,
          chainId: transition.id,
          nativeVersion: native.id,
          viewVersion: pinned.id,
          rootVertex,
          projectionOrder,
          complement: projected.complement,
          createdAt: this.now(),
        });
        migrated = projected.view;
        chainIds.push(transition.id);
        projectionOrder += 1;
      }
    }

    return {
      ...identity,
      value: migrated as T,
      nativeVersion: native.id,
      viewVersion: pinned.id,
      chainIds,
    };
  }

  /** Restore a foreign-version record before a swap-protected write. */
  async prepareWrite<T = unknown>(input: PrepareWriteInput): Promise<T> {
    if (input.nativeVersion === this.pinnedVersion) return input.editedValue as T;
    const native = this.versionById.get(input.nativeVersion);
    const pinned = this.versionById.get(this.pinnedVersion)!;
    if (!native) throw new UnknownSchemaVersionError(input.collection, [...this.versionById.keys()]);
    if (native.order < pinned.order) {
      // An older record was already lifted to the pinned shape; natural writes
      // upgrade it to the pinned version and require no complement.
      return input.editedValue as T;
    }

    const custody = await this.complements.list(input.recordUri, input.cid);
    if (!custody.length || custody.length !== input.chainIds.length) {
      throw new ComplementConflict("The complement needed to edit this foreign-version record is missing", {
        recordUri: input.recordUri,
        cid: input.cid,
      });
    }

    let restored = input.editedValue;
    for (const record of [...custody].sort((left, right) => right.projectionOrder - left.projectionOrder)) {
      const transition = await this.transitionById(record.chainId);
      try {
        restored = await transition.backward.restore(restored, record.complement, record.rootVertex);
      } catch (error) {
        throw normalizeComplementError(error, {
          recordUri: input.recordUri,
          cid: input.cid,
          chainId: record.chainId,
        });
      }
    }
    return restored as T;
  }

  close(): void {
    this.complements.close();
  }

  private engine(): Promise<PanprotoEngine> {
    this.enginePromise ??= this.loadEngine();
    return this.enginePromise;
  }

  private transition(olderVersion: string, newerVersion: string): Promise<SchemaTransition> {
    const definition = this.transitionDefinitions.find(
      (candidate) => candidate.olderVersion === olderVersion && candidate.newerVersion === newerVersion,
    );
    if (!definition) throw new MissingSchemaTransitionError(olderVersion, newerVersion);
    return this.loadTransition(definition);
  }

  private transitionById(id: string): Promise<SchemaTransition> {
    const definition = this.transitionDefinitions.find((candidate) => candidate.id === id);
    if (!definition) throw new MissingSchemaTransitionError(id, "registered transition");
    return this.loadTransition(definition);
  }

  private loadTransition(definition: SchemaTransitionDefinition): Promise<SchemaTransition> {
    let transition = this.transitionCache.get(definition.id);
    if (!transition) {
      transition = this.engine().then(definition.load);
      this.transitionCache.set(definition.id, transition);
    }
    return transition;
  }
}

export async function createSchemaRuntime(
  options: Omit<SchemaRuntimeOptions, "complements"> & { readonly complements?: ComplementStore },
): Promise<SchemaRuntime> {
  return new SchemaRuntime({ ...options, complements: options.complements ?? (await openComplementStore()) });
}

/** Adapt compiled JSON migrations to the transition interface. */
export function compiledMigrationTransition(options: {
  readonly id: string;
  readonly olderVersion: string;
  readonly newerVersion: string;
  readonly rootVertex: (collection: string) => string;
  readonly forward: CompiledMigration;
  /** Compiled with the newer schema as source and the older schema as target. */
  readonly backward: CompiledMigration;
}): SchemaTransition {
  return {
    id: options.id,
    olderVersion: options.olderVersion,
    newerVersion: options.newerVersion,
    rootVertex: options.rootVertex,
    forward: {
      lift: (value, rootVertex) => options.forward.liftJson(value, rootVertex),
    },
    backward: {
      project: (value, rootVertex) => options.backward.getJson(value, rootVertex),
      restore: (view, complement, rootVertex) => options.backward.putJson(view, complement, rootVertex),
    },
  };
}
