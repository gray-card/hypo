export interface ComplementErrorContext {
  readonly recordUri: string;
  readonly cid: string;
  readonly chainId?: string;
}

export class UnknownSchemaVersionError extends Error {
  readonly name = "UnknownSchemaVersionError";

  constructor(
    readonly collection: string,
    readonly availableVersions: readonly string[],
  ) {
    super(`Record in ${collection} does not match a supported schema version`);
  }
}

export class MissingSchemaTransitionError extends Error {
  readonly name = "MissingSchemaTransitionError";

  constructor(
    readonly fromVersion: string,
    readonly toVersion: string,
  ) {
    super(`No schema transition is registered from ${fromVersion} to ${toVersion}`);
  }
}

export class ComplementFingerprintMismatch extends Error {
  readonly name = "ComplementFingerprintMismatch";

  constructor(
    message: string,
    readonly context: ComplementErrorContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ComplementConflict extends Error {
  readonly name = "ComplementConflict";

  constructor(
    message: string,
    readonly context: ComplementErrorContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function normalizeComplementError(error: unknown, context: ComplementErrorContext): Error {
  if (error instanceof ComplementFingerprintMismatch || error instanceof ComplementConflict) return error;
  const source = error instanceof Error ? error : new Error(String(error));
  const description = `${source.name}: ${source.message}`;
  if (/fingerprint/i.test(description)) {
    return new ComplementFingerprintMismatch(source.message, context, { cause: source });
  }
  if (/complement|key disagreement|conflict/i.test(description)) {
    return new ComplementConflict(source.message, context, { cause: source });
  }
  return source;
}
