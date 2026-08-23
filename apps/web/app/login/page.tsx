import LoginButton from "@/components/LoginButton";

export default function LoginPage() {
  return (
    <main>
      <h1>Sign in</h1>
      <p className="login-copy">
        Sign in with GitHub to open your boards. This button stays on the page
        even if NextAuth env is incomplete — fix GITHUB_ID, GITHUB_SECRET, and
        NEXTAUTH_SECRET in apps/web/.env.local, then try again.
      </p>
      <LoginButton />
    </main>
  );
}
