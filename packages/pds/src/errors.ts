import type { ValidationIssue } from "./types.js";

export interface PdsErrorOptions extends ErrorOptions {
  code?: string;
  status?: number;
  operation?: string;
}

export class PdsError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly operation?: string;

  constructor(message: string, options: PdsErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
    this.operation = options.operation;
  }
}

export class NetworkError extends PdsError {}

export class AuthError extends PdsError {}

export class SwapConflict extends PdsError {
  readonly expectedCid?: string;

  constructor(message: string, options: PdsErrorOptions & { expectedCid?: string } = {}) {
    super(message, options);
    this.expectedCid = options.expectedCid;
  }
}

export class ValidationError extends PdsError {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, options: PdsErrorOptions & { issues?: readonly ValidationIssue[] } = {}) {
    super(message, options);
    this.issues = options.issues ?? [];
  }
}

interface ErrorShape {
  name?: unknown;
  message?: unknown;
  error?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
}

function shapeOf(error: unknown): ErrorShape {
  return typeof error === "object" && error !== null ? (error as ErrorShape) : {};
}

function errorCode(shape: ErrorShape): string | undefined {
  for (const value of [shape.error, shape.code]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function errorStatus(shape: ErrorShape): number | undefined {
  for (const value of [shape.status, shape.statusCode, shape.response?.status]) {
    if (typeof value === "number") return value;
  }
  return undefined;
}

function errorMessage(error: unknown, shape: ErrorShape): string {
  return typeof shape.message === "string" && shape.message.length > 0
    ? shape.message
    : error instanceof Error
      ? error.message
      : String(error);
}

const AUTH_CODES = new Set(["AuthenticationRequired", "AuthRequired", "ExpiredToken", "InvalidToken", "Unauthorized"]);
const VALIDATION_CODES = new Set(["InvalidRecord", "InvalidRequest", "LexiconValidationFailed", "ValidationError"]);

export function mapPdsError(error: unknown, operation: string, context: { expectedCid?: string } = {}): PdsError {
  if (error instanceof PdsError) return error;

  const shape = shapeOf(error);
  const code = errorCode(shape);
  const status = errorStatus(shape);
  const message = errorMessage(error, shape);
  const options = { cause: error, code, status, operation };

  if (code === "InvalidSwap" || shape.name === "InvalidSwapError") {
    return new SwapConflict(message, { ...options, expectedCid: context.expectedCid });
  }
  if (status === 401 || status === 403 || (code !== undefined && AUTH_CODES.has(code))) {
    return new AuthError(message, options);
  }
  if (code !== undefined && VALIDATION_CODES.has(code)) {
    return new ValidationError(message, options);
  }

  // @atproto's XRPCError uses status 1 for a request that never received an
  // HTTP response. Fetch reports the same condition as a TypeError.
  if (status === undefined || status === 1 || status >= 500 || error instanceof TypeError) {
    return new NetworkError(message, options);
  }
  return new PdsError(message, options);
}
