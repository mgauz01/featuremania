"use client";

import { signIn } from "next-auth/react";

export default function LoginButton() {
  return (
    <button type="button" onClick={() => signIn("github")}>
      Sign in with GitHub
    </button>
  );
}
