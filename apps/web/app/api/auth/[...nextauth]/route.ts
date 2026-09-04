import NextAuth, { type AuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import type { JWT } from "next-auth/jwt";
import { attachGithubUserId } from "@/lib/session-user";

export type JwtToken = JWT & { accessToken?: string };

export function persistGitHubAccessToken({
  token,
  account,
}: {
  token: JwtToken;
  account?: { access_token?: string } | null;
}): JwtToken {
  if (account?.access_token) {
    return { ...token, accessToken: account.access_token };
  }
  return token;
}

export const authOptions: AuthOptions = {
  pages: {
    signIn: "/login",
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
      authorization: {
        params: { scope: "read:user repo read:org" },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      return persistGitHubAccessToken({ token, account });
    },
    async session({ session, token }) {
      return attachGithubUserId({ session, token });
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
