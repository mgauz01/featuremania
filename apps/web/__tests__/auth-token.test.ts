import { expect, test } from "vitest";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { authOptions, persistGitHubAccessToken } from "@/app/api/auth/[...nextauth]/route";
import { attachGithubUserId } from "@/lib/session-user";

test("GitHub provider requests repo, read:user, and read:org scopes", () => {
  const github = authOptions.providers[0] as {
    options?: { authorization?: { params?: { scope?: string } } };
    authorization?: { params?: { scope?: string } };
  };
  const scope =
    github.options?.authorization?.params?.scope ?? github.authorization?.params?.scope ?? "";
  expect(scope).toContain("repo");
  expect(scope).toContain("read:user");
  expect(scope).toContain("read:org");
});

test("jwt callback stores GitHub access token and later calls keep it", () => {
  const first = persistGitHubAccessToken({ token: { sub: "1" }, account: { access_token: "gho_test" } });
  expect(first.accessToken).toBe("gho_test");
  const later = persistGitHubAccessToken({ token: first });
  expect(later.accessToken).toBe("gho_test");
});

test("session callback copies GitHub account id and not the access token", async () => {
  const sessionCb = authOptions.callbacks?.session;
  expect(sessionCb).toBeTypeOf("function");
  const session: Session = {
    user: { name: "Ada", email: "ada@example.com" },
    expires: "2099-01-01T00:00:00.000Z",
  };
  const token: JWT = { sub: "12345", accessToken: "gho_secret" };
  const result = await (sessionCb as (args: { session: Session; token: JWT }) => Session | Promise<Session>)({
    session,
    token,
  });
  expect(result.user?.id).toBe("12345");
  expect(result).not.toHaveProperty("accessToken");
  expect(result.user).not.toHaveProperty("accessToken");
  expect(attachGithubUserId({ session, token }).user?.id).toBe("12345");
});

test("custom sign-in page is /login so middleware does not use /api/auth/signin", () => {
  expect(authOptions.pages?.signIn).toBe("/login");
});
