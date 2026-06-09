import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";

describe("telemetry cli", () => {
  test("parses telemetry subcommands", () => {
    const list = parseCli(["telemetry", "list", "--json"]);
    expect(list.errors).toHaveLength(0);
    expect(list.command?.kind).toBe("telemetry");
    if (list.command?.kind === "telemetry") {
      expect(list.command.subcommand).toBe("list");
      expect(list.command.json).toBe(true);
    }

    const inspect = parseCli(["telemetry", "inspect", "abc123"]);
    expect(inspect.errors).toHaveLength(0);
    if (inspect.command?.kind === "telemetry") {
      expect(inspect.command.traceId).toBe("abc123");
    }

    const flush = parseCli(["telemetry", "flush", "--sink", "local"]);
    if (flush.command?.kind === "telemetry") {
      expect(flush.command.sink).toBe("local");
    }
  });

  test("includes telemetry inspect target", () => {
    const parsed = parseCli(["inspect", "telemetry", "--json"]);
    expect(parsed.errors).toHaveLength(0);
    if (parsed.command?.kind === "inspect") {
      expect(parsed.command.target).toBe("telemetry");
    }
  });
});
