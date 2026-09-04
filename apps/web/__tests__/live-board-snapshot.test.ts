import { afterEach, expect, test } from "vitest";
import {
  DEFAULT_BOARD_ID,
  DEFAULT_BOARD_NAME,
  LIVE_BOARD_SNAPSHOT_KEY,
  asIssue,
  issueKeyFor,
  selectionKeyFor,
  nextBoardId,
  readLiveBoardSnapshot,
  wipeLiveBoardSnapshot,
  writeLiveBoardSnapshot,
} from "@/lib/live-board-snapshot";

afterEach(() => {
  window.localStorage.clear();
});

const issues = [
  {
    id: 11,
    title: "Real issue",
    score: 1.2,
    repo: "mozilla-ai/otari",
    status: "backlog" as const,
    summary: "A summary",
    score_reason: "Five closing-PR commits lift this score.",
  },
];

test("round-trips last issues and last pick for a GitHub user", () => {
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues,
  });
  expect(readLiveBoardSnapshot()).toEqual({
    v: 3,
    githubUserId: "12345",
    activeBoardId: DEFAULT_BOARD_ID,
    boards: [
      {
        id: DEFAULT_BOARD_ID,
        name: DEFAULT_BOARD_NAME,
        selectedRepos: ["mozilla-ai/otari"],
        issues,
        groups: [],
      },
    ],
    selectedRepos: ["mozilla-ai/otari"],
    issues,
  });
});

test("stores only known snapshot fields, never tokens or Otari keys", () => {
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues,
  });
  const stored = JSON.parse(window.localStorage.getItem(LIVE_BOARD_SNAPSHOT_KEY) ?? "{}") as Record<
    string,
    unknown
  >;
  expect(Object.keys(stored).sort()).toEqual(["activeBoardId", "boards", "githubUserId", "v"]);
  expect(stored).not.toHaveProperty("accessToken");
  expect(stored).not.toHaveProperty("otariApiKey");
  expect(JSON.stringify(stored)).not.toMatch(/gho_|tk_/);
});

test("ignores secret-looking fields if they were already on disk", () => {
  window.localStorage.setItem(
    LIVE_BOARD_SNAPSHOT_KEY,
    JSON.stringify({
      v: 1,
      githubUserId: "12345",
      selectedRepos: ["mozilla-ai/otari"],
      issues,
      accessToken: "gho_secret",
      otariApiKey: "tk_secret",
    }),
  );
  const snapshot = readLiveBoardSnapshot();
  expect(snapshot?.githubUserId).toBe("12345");
  expect(snapshot?.selectedRepos).toEqual(["mozilla-ai/otari"]);
  expect(snapshot?.issues).toEqual(issues);
  expect(snapshot).not.toHaveProperty("accessToken");
  expect(snapshot).not.toHaveProperty("otariApiKey");
});

test("migrates a version-1 snapshot into one named board", () => {
  window.localStorage.setItem(
    LIVE_BOARD_SNAPSHOT_KEY,
    JSON.stringify({
      v: 1,
      githubUserId: "12345",
      selectedRepos: ["mozilla-ai/otari"],
      issues,
    }),
  );
  expect(readLiveBoardSnapshot()).toMatchObject({
    v: 3,
    githubUserId: "12345",
    activeBoardId: DEFAULT_BOARD_ID,
    boards: [
      {
        id: DEFAULT_BOARD_ID,
        name: DEFAULT_BOARD_NAME,
        selectedRepos: ["mozilla-ai/otari"],
        issues,
        groups: [],
      },
    ],
  });
});

test("renames the active board without dropping other boards", () => {
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues,
  });
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues,
    name: "cq live",
  });
  expect(readLiveBoardSnapshot()?.boards[0]?.name).toBe("cq live");
});

test("nextBoardId skips ids that already exist", () => {
  expect(nextBoardId([{ id: "board-1", name: "Board 1", selectedRepos: [], issues: [], groups: [] }])).toBe(
    "board-2",
  );
});

test("wipe removes the snapshot", () => {
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues,
  });
  wipeLiveBoardSnapshot();
  expect(readLiveBoardSnapshot()).toBeNull();
  expect(window.localStorage.getItem(LIVE_BOARD_SNAPSHOT_KEY)).toBeNull();
});

test("derives a stable issueKey from repo and number, not sqlite id", () => {
  expect(issueKeyFor({ repo: "mozilla-ai/otari", number: 12 })).toBe("mozilla-ai/otari#12");
  expect(issueKeyFor({ repo: "mozilla-ai/otari" })).toBeUndefined();
  const parsed = asIssue({
    id: 99,
    title: "Real issue",
    score: 1.2,
    repo: "mozilla-ai/otari",
    number: 12,
  });
  expect(parsed?.issueKey).toBe("mozilla-ai/otari#12");
  expect(asIssue({ id: 1, title: "Real issue", score: 1, repo: "mozilla-ai/otari" })?.issueKey).toBeUndefined();
  expect(selectionKeyFor({ id: 7, repo: "acme/app", number: 3 })).toBe("acme/app#3");
  expect(selectionKeyFor({ id: 7 })).toBe("local:7");
  expect(selectionKeyFor({ id: -1, kind: "featuremania", issueKey: "fm:group:x" })).toBeUndefined();
});

test("keeps a v2 snapshot that has no GitHub number", () => {
  window.localStorage.setItem(
    LIVE_BOARD_SNAPSHOT_KEY,
    JSON.stringify({
      v: 2,
      githubUserId: "12345",
      activeBoardId: DEFAULT_BOARD_ID,
      boards: [
        {
          id: DEFAULT_BOARD_ID,
          name: DEFAULT_BOARD_NAME,
          selectedRepos: ["mozilla-ai/otari"],
          issues,
        },
      ],
    }),
  );
  expect(readLiveBoardSnapshot()?.issues[0]?.title).toBe("Real issue");
  expect(readLiveBoardSnapshot()?.issues[0]?.number).toBeUndefined();
});

test("round-trips grouping overlay on a named board", () => {
  const grouped = [
    {
      id: 11,
      title: "Login",
      score: 1.2,
      repo: "acme/app",
      number: 1,
      issueKey: "acme/app#1",
      status: "backlog" as const,
    },
  ];
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["acme/app"],
    issues: grouped,
    groups: [
      {
        id: "fm:group:test",
        title: "Auth cleanup",
        childKeys: ["acme/app#1", "acme/app#2"],
        mode: "parent",
      },
    ],
  });
  expect(readLiveBoardSnapshot()?.boards[0]?.groups).toEqual([
    {
      id: "fm:group:test",
      title: "Auth cleanup",
      childKeys: ["acme/app#1", "acme/app#2"],
      mode: "parent",
    },
  ]);
});

test("rejects a snapshot that is not a known version or has no GitHub user id", () => {
  window.localStorage.setItem(
    LIVE_BOARD_SNAPSHOT_KEY,
    JSON.stringify({ v: 4, githubUserId: "12345", selectedRepos: [], issues: [] }),
  );
  expect(readLiveBoardSnapshot()).toBeNull();
  window.localStorage.setItem(
    LIVE_BOARD_SNAPSHOT_KEY,
    JSON.stringify({ v: 1, selectedRepos: [], issues: [] }),
  );
  expect(readLiveBoardSnapshot()).toBeNull();
});
