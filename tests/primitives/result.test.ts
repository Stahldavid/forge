import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import {
  Result,
  ok,
  err,
  isOk,
  isErr,
} from "../../src/forge/compiler/primitives/result.ts";
import type { Result as ResultT } from "../../src/forge/compiler/primitives/result.ts";

describe("Result constructors and guards", () => {
  test("ok wraps a value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  test("err wraps an error", () => {
    const r = err("boom");
    expect(r.ok).toBe(false);
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("boom");
    }
  });

  test("namespace exposes the same constructors", () => {
    expect(Result.ok(1)).toEqual(ok(1));
    expect(Result.err("e")).toEqual(err("e"));
  });
});

describe("map / mapErr", () => {
  test("map transforms success, leaves error untouched", () => {
    const success: ResultT<number, string> = ok(2);
    expect(Result.map(success, (n: number) => n * 3)).toEqual(ok(6));
    const failure: ResultT<number, string> = err("nope");
    expect(Result.map(failure, (n: number) => n * 3)).toEqual(err("nope"));
  });

  test("mapErr transforms error, leaves success untouched", () => {
    const failure: ResultT<number, string> = err("x");
    expect(Result.mapErr(failure, (e: string) => `${e}!`)).toEqual(err("x!"));
    const success: ResultT<number, string> = ok(5);
    expect(Result.mapErr(success, (e: string) => `${e}!`)).toEqual(ok(5));
  });
});

describe("flatMap", () => {
  const half = (n: number): ResultT<number, string> =>
    n % 2 === 0 ? ok(n / 2) : err("odd");

  test("chains on success", () => {
    expect(Result.flatMap(ok(8), half)).toEqual(ok(4));
  });

  test("short-circuits on the first error", () => {
    expect(Result.flatMap(ok(7), half)).toEqual(err("odd"));
    expect(Result.flatMap(err("pre"), half)).toEqual(err("pre"));
  });
});

describe("unwrap variants", () => {
  test("unwrapOr returns fallback on error", () => {
    expect(Result.unwrapOr(ok(1), 99)).toBe(1);
    expect(Result.unwrapOr(err("e"), 99)).toBe(99);
  });

  test("unwrapOrElse computes fallback from error", () => {
    expect(Result.unwrapOrElse(err("abc"), (e) => e.length)).toBe(3);
    expect(Result.unwrapOrElse(ok(7), (e: string) => e.length)).toBe(7);
  });

  test("unwrap returns value or throws", () => {
    expect(Result.unwrap(ok("v"))).toBe("v");
    expect(() => Result.unwrap(err("bad"))).toThrow();
    expect(() => Result.unwrap(err("bad"), "custom")).toThrow("custom");
  });
});

describe("all", () => {
  test("collects all success values", () => {
    expect(Result.all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
  });

  test("returns the first failure", () => {
    const results: ResultT<number, string>[] = [ok(1), err("first"), err("second")];
    expect(Result.all(results)).toEqual(err("first"));
  });

  test("empty input yields ok of empty array", () => {
    expect(Result.all([])).toEqual(ok([]));
  });
});

describe("fromThrowable", () => {
  test("captures thrown errors", () => {
    const r = Result.fromThrowable(() => {
      throw new Error("kaboom");
    });
    expect(r.ok).toBe(false);
  });

  test("maps the caught error when a mapper is provided", () => {
    const r = Result.fromThrowable(
      () => {
        throw new Error("kaboom");
      },
      (e) => (e instanceof Error ? e.message : "unknown"),
    );
    expect(r).toEqual(err("kaboom"));
  });

  test("returns ok for non-throwing functions", () => {
    expect(Result.fromThrowable(() => 5)).toEqual(ok(5));
  });
});

describe("Result laws (property-based)", () => {
  test("left identity: flatMap(ok(a), f) === f(a)", () => {
    fc.assert(
      fc.property(fc.integer(), (a) => {
        const f = (n: number): ResultT<number, string> => ok(n + 1);
        expect(Result.flatMap(ok(a), f)).toEqual(f(a));
      }),
    );
  });

  test("right identity: flatMap(m, ok) === m", () => {
    fc.assert(
      fc.property(fc.integer(), (a) => {
        const m: ResultT<number, string> = ok(a);
        expect(Result.flatMap(m, ok)).toEqual(m);
      }),
    );
  });

  test("map identity: map(m, x => x) === m", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.constant(null)), (a) => {
        const m: ResultT<number | null, string> = a === null ? err("e") : ok(a);
        expect(Result.map(m, (x) => x)).toEqual(m);
      }),
    );
  });

  test("map composition: map(map(m, f), g) === map(m, x => g(f(x)))", () => {
    fc.assert(
      fc.property(fc.integer(), (a) => {
        const f = (n: number) => n + 1;
        const g = (n: number) => n * 2;
        const m: ResultT<number, string> = ok(a);
        expect(Result.map(Result.map(m, f), g)).toEqual(
          Result.map(m, (x) => g(f(x))),
        );
      }),
    );
  });
});
