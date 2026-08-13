export class CatalogError extends Error {
  override readonly name: string = "CatalogError";
}

export class CatalogFetchError extends CatalogError {
  override readonly name = "CatalogFetchError";

  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class CatalogFormatError extends CatalogError {
  override readonly name = "CatalogFormatError";
}

export class CatalogIntegrityError extends CatalogError {
  override readonly name = "CatalogIntegrityError";

  constructor(
    message: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(message);
  }
}
