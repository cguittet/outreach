import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("extension permissions", () => {
  it("has no content script or persistent LinkedIn host access", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../public/manifest.json"), "utf8"));
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.permissions).not.toContain("scripting");
  });
});
