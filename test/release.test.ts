import { describe, expect, test } from "bun:test";
import { publicationState, registryState, releaseNotes, waitForPublication } from "../scripts/release";

describe("release metadata", () => {
  test("extracts only the exact version and preserves Markdown", () => {
    const changelog =
      "# Changelog\r\n\r\n## Unreleased\r\n- Future.\r\n\r\n## 0.5.0\r\n\r\n- Ship it.\r\n\r\n## 0.4.0\r\n- Old.\r\n";
    expect(releaseNotes("0.5.0", "v0.5.0", changelog)).toBe("- Ship it.\n");
  });

  test("rejects mismatched tags and unsupported versions", () => {
    for (const [version, tag] of [
      ["0.5.0", "v0.6.0"],
      ["0.5.0", "0.5.0"],
      ["01.0.0", "v01.0.0"],
      ["0.6.0-rc.1", "v0.6.0-rc.1"],
    ]) {
      expect(() => releaseNotes(version, tag, `## ${version}\n- Change.\n`)).toThrow("Release tag");
    }
  });

  test("rejects missing, duplicate, or empty changelog entries", () => {
    for (const changelog of ["## 0.4.0\n- Old.\n", "## 0.5.0\n", "## 0.5.0\n- A.\n## 0.5.0\n- B.\n"]) {
      expect(() => releaseNotes("0.5.0", "v0.5.0", changelog)).toThrow("CHANGELOG.md");
    }
  });
});

const packed = {
  name: "deepseek-web-retrieval",
  version: "0.5.0",
  filename: "package.tgz",
  integrity: "sha512-candidate",
};
const published = { name: packed.name, version: packed.version, dist: { integrity: packed.integrity } };

describe("publication recovery", () => {
  test("waits through npm processing beyond the old 25-second window", async () => {
    let elapsed = 0;
    const state = await waitForPublication(
      async () => ({ exists: elapsed >= 180_000, latest: elapsed >= 180_000 }),
      async () => {
        elapsed += 10_000;
      },
    );
    expect(state).toEqual({ exists: true, latest: true });
    expect(elapsed).toBe(180_000);
  });

  test("stops after five minutes with recovery guidance", async () => {
    let elapsed = 0;
    await expect(
      waitForPublication(
        async () => ({ exists: false, latest: false }),
        async () => {
          elapsed += 10_000;
        },
      ),
    ).rejects.toThrow("rerun failed jobs");
    expect(elapsed).toBe(300_000);
  });

  test("does not retry authentication or integrity errors while waiting", async () => {
    let pauses = 0;
    await expect(
      waitForPublication(
        async () => {
          throw new Error("different package contents");
        },
        async () => {
          pauses++;
        },
      ),
    ).rejects.toThrow("different package contents");
    expect(pauses).toBe(0);
  });

  test("publishes a new version, including numerical version ordering", () => {
    expect(publicationState(packed, {})).toEqual({ exists: false, latest: false });
    expect(publicationState({ ...packed, version: "0.10.0" }, { "dist-tags": { latest: "0.9.0" } }).exists).toBe(false);
  });

  test("an identical published package can resume GitHub Release creation", () => {
    expect(publicationState(packed, { versions: { "0.5.0": published }, "dist-tags": { latest: "0.5.0" } })).toEqual({
      exists: true,
      latest: true,
    });
  });

  test("an older identical release cannot replace the current latest release", () => {
    expect(publicationState(packed, { versions: { "0.5.0": published }, "dist-tags": { latest: "0.6.0" } })).toEqual({
      exists: true,
      latest: false,
    });
  });

  test("refuses version collisions and missing integrity", () => {
    for (const dist of [{ integrity: "sha512-other" }, {}]) {
      expect(() => publicationState(packed, { versions: { "0.5.0": { ...published, dist } } })).toThrow(
        "different package contents",
      );
    }
  });

  test("refuses a new version older than latest", () => {
    expect(() => publicationState(packed, { "dist-tags": { latest: "0.6.0" } })).toThrow("backwards");
  });

  test("does not interpret authentication, outage, or invalid metadata as an unpublished version", async () => {
    for (const status of [401, 403, 429, 500]) {
      await expect(registryState(packed, async () => new Response("error", { status }))).rejects.toThrow(
        `HTTP ${status}`,
      );
    }
    await expect(registryState(packed, async () => Response.json({}))).rejects.toThrow("Invalid npm registry metadata");
    await expect(registryState(packed, async () => new Response("missing", { status: 404 }))).resolves.toEqual({
      exists: false,
      latest: false,
    });
  });
});
