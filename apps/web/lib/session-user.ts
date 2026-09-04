import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

export function attachGithubUserId({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Session {
  if (!session.user) {
    return session;
  }
  const id = typeof token.sub === "string" ? token.sub : "";
  return {
    ...session,
    user: {
      ...session.user,
      id,
    },
  };
}
