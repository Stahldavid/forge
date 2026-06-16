import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("security assurance: standards crosswalk", () => {
  test("maps public standards to ForgeOS evidence without claiming certification", () => {
    const crosswalk = readFileSync("security/STANDARDS_CROSSWALK.md", "utf8");

    expect(crosswalk).toContain("not a certification claim");
    expect(crosswalk).toContain("OWASP ASVS");
    expect(crosswalk).toContain("OWASP API Top 10");
    expect(crosswalk).toContain("OWASP LLM Top 10");
    expect(crosswalk).toContain("NIST SSDF");
    expect(crosswalk).toContain("SLSA");
    expect(crosswalk).toContain("npm provenance");
    expect(crosswalk).toContain("forge security prove --json");
    expect(crosswalk).toContain("forge rls test --db postgres --json");
    expect(crosswalk).toContain("NPM_CONFIG_PROVENANCE=true");
    expect(crosswalk).toContain("SBOM");
  });
});
