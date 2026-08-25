import { expect, test, vi } from "vitest";

vi.mock("next-auth/middleware", () => ({
  withAuth: (options: unknown) => options,
}));

import middleware, { signInPage } from "@/middleware";

test("middleware uses sign-in page /login", () => {
  expect(signInPage).toBe("/login");
  expect(middleware).toMatchObject({ pages: { signIn: "/login" } });
});
