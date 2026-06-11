/**
 * Result<T, E> — a unified, type-safe success/failure value.
 *
 * ForgeOS historically mixed three error-signalling styles: thrown exceptions
 * from I/O code, `null` returns from lookups, and `Diagnostic[]` from the
 * compiler pipeline. `Result` gives leaf code a single, composable primitive so
 * callers can no longer confuse "produced nothing" with "failed".
 *
 * Conventions:
 * - The default error type is `Diagnostic[]`, matching the compiler pipeline.
 * - Construct with {@link ok} / {@link err}.
 * - Narrow with the `result.ok` discriminant, or use the combinators below.
 * - Keep these helpers pure and dependency-free (primitive layer rules).
 */
import type { Diagnostic } from "../types/diagnostic.ts";

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = Diagnostic[]> = Ok<T> | Err<E>;

/** Wrap a success value. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wrap a failure value. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Type guard narrowing a `Result` to its success branch. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Type guard narrowing a `Result` to its failure branch. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transform the success value, leaving failures untouched. */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transform the failure value, leaving successes untouched. */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chain a fallible computation onto a success (monadic bind). */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Return the success value or a fallback when the result is a failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Return the success value or compute a fallback from the error. */
export function unwrapOrElse<T, E>(
  result: Result<T, E>,
  fn: (error: E) => T,
): T {
  return result.ok ? result.value : fn(result.error);
}

/**
 * Return the success value or throw. Use only at boundaries where a failure is
 * genuinely unexpected; prefer the combinators above in normal flow.
 */
export function unwrap<T, E>(result: Result<T, E>, message?: string): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(message ?? `unwrap called on Err: ${stringifyError(result.error)}`);
}

/**
 * Collect an array of results into a single result. Returns the first failure
 * encountered, or an array of all success values when every result is `ok`.
 */
export function all<T, E>(results: ReadonlyArray<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Run a throwing function and capture any exception as an `Err`. The optional
 * `onError` mapper converts the caught value into the desired error type
 * (defaults to the raw `unknown`).
 */
export function fromThrowable<T>(fn: () => T): Result<T, unknown>;
export function fromThrowable<T, E>(
  fn: () => T,
  onError: (error: unknown) => E,
): Result<T, E>;
export function fromThrowable<T, E>(
  fn: () => T,
  onError?: (error: unknown) => E,
): Result<T, E | unknown> {
  try {
    return ok(fn());
  } catch (error) {
    return err(onError ? onError(error) : error);
  }
}

/**
 * Value-namespace companion to the `Result` type. Lets consumers import a
 * single symbol and call `Result.ok(...)`, `Result.map(...)`, etc., without
 * leaking generic helper names (`map`, `all`, ...) through barrel re-exports.
 */
export const Result = {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  flatMap,
  unwrapOr,
  unwrapOrElse,
  unwrap,
  all,
  fromThrowable,
} as const;

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (Array.isArray(error)) {
    return error.map((item) => stringifyError(item)).join("; ");
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
