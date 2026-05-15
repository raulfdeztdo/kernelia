import { describe, expect, it } from "vitest";
import { AdminStatusError } from "@/db/queries/admin-articles";

/**
 * Pure-helper coverage. `adminSetArticleStatus` itself runs SQL so it gets
 * integration coverage through the route handler (manual smoke), but the
 * `AdminStatusError` shape is part of the route's typed 422 envelope and
 * must stay stable — break it and the UI silently regresses to a generic
 * error toast.
 */
describe("AdminStatusError", () => {
  it("carries a typed `code` and `name`", () => {
    const err = new AdminStatusError("not_found");
    expect(err.code).toBe("not_found");
    expect(err.name).toBe("AdminStatusError");
    expect(err).toBeInstanceOf(Error);
  });

  it("carries `missingColumns` when code is missing_columns", () => {
    const err = new AdminStatusError("missing_columns", ["title_es", "summary_en"]);
    expect(err.code).toBe("missing_columns");
    expect(err.missingColumns).toEqual(["title_es", "summary_en"]);
  });

  it("preserves the order of missingColumns so the UI can list them deterministically", () => {
    const cols = ["category_id", "title_es", "title_en", "summary_es", "summary_en"];
    const err = new AdminStatusError("missing_columns", cols);
    expect(err.missingColumns).toEqual(cols);
  });
});
