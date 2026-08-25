"use client";

import { signIn } from "next-auth/react";

export default function LoginButton() {
  return (
    <button type="button" onClick={() => signIn("github", { callbackUrl: "/board/1" })}>
      Sign in with GitHub
    </button>
  );
}
