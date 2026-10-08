/** @public */
export class UnetApiError extends Error {
  public readonly name = 'UnetApiError';
  public constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
    public readonly payload?: unknown,
  ) { super(message); }
}

/** @public */
export class UnetTimeoutError extends Error {
  public readonly name = 'UnetTimeoutError';
  public constructor(message = 'U-net operation timed out') { super(message); }
}

/** @public */
export class UnetContractError extends Error {
  public readonly name = 'UnetContractError';
  public constructor(message: string, public readonly payload?: unknown) { super(message); }
}
