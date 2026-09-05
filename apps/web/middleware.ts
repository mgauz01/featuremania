import { withAuth } from "next-auth/middleware";

export const signInPage = "/login";

export default withAuth({
  pages: {
    signIn: signInPage,
  },
});

export const config = {
  matcher: ["/((?!api/|login|_next/static|_next/image|favicon.ico).*)"],
};
