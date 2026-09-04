import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import SignOutButton from "@/components/SignOutButton";
import {
  LIVE_BOARD_SNAPSHOT_KEY,
  writeLiveBoardSnapshot,
} from "@/lib/live-board-snapshot";

const sessionState = vi.hoisted(() => ({
  status: "authenticated" as "authenticated" | "unauthenticated" | "loading",
}));

const signOut = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: sessionState.status === "authenticated" ? { user: { id: "gh-1" } } : null,
    status: sessionState.status,
  }),
  signOut,
}));

afterEach(() => {
  sessionState.status = "authenticated";
  signOut.mockReset();
  window.localStorage.clear();
});

test("Sign out is hidden until a GitHub session exists", () => {
  sessionState.status = "unauthenticated";
  render(<SignOutButton />);
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
});

test("Sign out ends the session and wipes the live-board snapshot", () => {
  writeLiveBoardSnapshot({
    githubUserId: "gh-1",
    selectedRepos: ["mozilla-ai/otari"],
    issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "mozilla-ai/otari", status: "backlog" }],
  });
  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  expect(window.localStorage.getItem(LIVE_BOARD_SNAPSHOT_KEY)).toBeNull();
});
