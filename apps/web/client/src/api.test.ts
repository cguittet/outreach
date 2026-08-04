import { describe, expect, it } from "vitest";
import { titleCase } from "./api";

describe("titleCase", () => {
  it("turns workflow identifiers into readable labels", () => {
    expect(titleCase("reply_needed")).toBe("Reply Needed");
    expect(titleCase("not_connected")).toBe("Not Connected");
  });
});
