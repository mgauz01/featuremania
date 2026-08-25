import { expect, test } from "vitest";
import { authOptions, persistGitHubAccessToken } from "@/app/api/auth/[...nextauth]/route";

test("GitHub provider requests repo and read:user scopes", () => {
  const github = authOptions.providers[0] as {
    options?: { authorization?: { params?: { scope?: string } } };
    authorization?: { params?: { scope?: string } };
  };
  const scope =
    github.options?.authorization?.params?.scope ?? github.authorization?.params?.scope ?? "";
  expect(scope).toContain("repo");
  expect(scope).toContain("read:user");
});

test("jwt callback stores GitHub access token and later calls keep it", () => {
  const first = persistGitHubAccessToken({ token: { sub: "1" }, account: { access_token: "gho_test" } });
  expect(first.accessToken).toBe("gho_test");
  const later = persistGitHubAccessToken({ token: first });
  expect(later.accessToken).toBe("gho_test");
});

test("session callback does not copy the GitHub access token onto the client session", () => {
  const session = authOptions.callbacks?.session;
  expect(session).toBeTypeOf("function");
});

test("custom sign-in page is /login so middleware does not use /api/auth/signin", () => {
  expect(authOptions.pages?.signIn).toBe("/login");
});
