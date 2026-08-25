import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { redirect } from "next/navigation";
import Home from "@/app/page";

test("Home redirects to /board/1", () => {
  Home();
  expect(redirect).toHaveBeenCalledWith("/board/1");
});
