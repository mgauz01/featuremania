import { expect, test, vi } from "vitest";

vi.mock("next-auth/middleware", () => ({
  withAuth: (options: unknown) => options,
}));

import middleware, { config, signInPage } from "@/middleware";

test("middleware uses sign-in page /login", () => {
  expect(signInPage).toBe("/login");
  expect(middleware).toMatchObject({ pages: { signIn: "/login" } });
});

test("middleware does not intercept API routes", () => {
  expect(config.matcher).toEqual(["/((?!api/|login|_next/static|_next/image|favicon.ico).*)"]);
});
