import { describe, expect, it } from "vitest";
import { clean } from "../src/style.ts";
import { livrable } from "../src/render.ts";
import { emptyState } from "@narthex/core";

describe("clean", () => {
  it("strips terminal control sequences from model or web text", () => {
    expect(clean("Prix\u001b]0;pwned\u0007 moyen\u001b[2J : 34 €\u009b")).toBe("Prix]0;pwned moyen[2J : 34 €");
  });
  it("keeps line breaks and tabs", () => {
    expect(clean("a\nb\tc")).toBe("a\nb\tc");
  });
  it("is applied to deliverables printed in the terminal", () => {
    const out = livrable(emptyState(), { id: "d", taskId: "t", agentId: "a", title: "T\u001b[31m", summary: "s", body: "x\u001b]8;;evil\u0007y", sources: [{ title: "S\u001b" }], createdAt: 0 });
    expect(out.includes("\u001b]8")).toBe(false);
    expect(out.includes("T\u001b[31m")).toBe(false);
  });
});
