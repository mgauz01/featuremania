"use client";

import { signOut, useSession } from "next-auth/react";
import { wipeLiveBoardSnapshot } from "@/lib/live-board-snapshot";

export default function SignOutButton() {
  const { status } = useSession();
  if (status !== "authenticated") {
    return null;
  }
  return (
    <button
      type="button"
      className="sign-out"
      onClick={() => {
        wipeLiveBoardSnapshot();
        void signOut({ callbackUrl: "/login" });
      }}
    >
      Sign out
    </button>
  );
}
