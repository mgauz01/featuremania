import { expect, test } from "vitest";
import { POST } from "@/app/api/live/overlap/route";

test("overlap route exports POST so Next can compile /api/live/overlap", () => {
  expect(typeof POST).toBe("function");
});
