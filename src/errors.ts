/** Error types, so callers can branch on failure modes without string matching. */

export type PixelRevealErrorCode =
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'DECODE_FAILED'
  | 'IMAGE_TOO_SMALL'
  | 'IMAGE_TOO_LARGE'
  | 'EFFECT_NOT_FOUND'
  | 'ENCODE_FAILED'
  | 'ABORTED';

export class PixelRevealError extends Error {
  readonly code: PixelRevealErrorCode;

  constructor(code: PixelRevealErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PixelRevealError';
    this.code = code;
  }
}

export function isPixelRevealError(value: unknown): value is PixelRevealError {
  return value instanceof PixelRevealError;
}
