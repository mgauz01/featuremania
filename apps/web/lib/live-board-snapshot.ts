import type { KanbanIssue, IssueStatus } from "@/components/KanbanBoard";
import { asGroup, type LiveGroup } from "@/lib/live-grouping";

export function issueKeyFor(issue: { repo?: string; number?: number }): string | undefined {
  if (!issue.repo || typeof issue.number !== "number") {
    return undefined;
  }
  return `${issue.repo}#${issue.number}`;
}

export function selectionKeyFor(issue: {
  id: number;
  repo?: string;
  number?: number;
  issueKey?: string;
  kind?: "github" | "featuremania";
}): string | undefined {
  if (issue.kind === "featuremania") {
    return undefined;
  }
  return issueKeyFor(issue) ?? issue.issueKey ?? `local:${issue.id}`;
}

export const LIVE_BOARD_SNAPSHOT_KEY = "featuremania.live-board.v1";
export const DEFAULT_BOARD_ID = "board-1";
export const DEFAULT_BOARD_NAME = "Board 1";

export type NamedLiveBoard = {
  id: string;
  name: string;
  selectedRepos: string[];
  issues: KanbanIssue[];
  groups: LiveGroup[];
};

export type LiveBoardSnapshot = {
  v: 3;
  githubUserId: string;
  activeBoardId: string;
  boards: NamedLiveBoard[];
  selectedRepos: string[];
  issues: KanbanIssue[];
};

function asStatus(value: unknown): IssueStatus | undefined {
  if (
    value === "backlog" ||
    value === "triaged" ||
    value === "in_progress" ||
    value === "in_review" ||
    value === "done"
  ) {
    return value;
  }
  return undefined;
}

export function asIssue(value: unknown): KanbanIssue | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const issue = value as Record<string, unknown>;
  if (typeof issue.id !== "number" || typeof issue.title !== "string" || typeof issue.score !== "number") {
    return null;
  }
  const parsed: KanbanIssue = {
    id: issue.id,
    title: issue.title,
    score: issue.score,
  };
  if (typeof issue.repo === "string") {
    parsed.repo = issue.repo;
  }
  if (typeof issue.summary === "string") {
    parsed.summary = issue.summary;
  }
  if (typeof issue.category === "string") {
    parsed.category = issue.category;
  }
  const status = asStatus(issue.status);
  if (status) {
    parsed.status = status;
  }
  if (typeof issue.last_activity_at === "string") {
    parsed.last_activity_at = issue.last_activity_at;
  }
  if (typeof issue.commits_on_closing_prs === "number") {
    parsed.commits_on_closing_prs = issue.commits_on_closing_prs;
  }
  if (typeof issue.subtasks_count === "number") {
    parsed.subtasks_count = issue.subtasks_count;
  }
  if (typeof issue.comments_count === "number") {
    parsed.comments_count = issue.comments_count;
  }
  if (typeof issue.score_reason === "string") {
    parsed.score_reason = issue.score_reason;
  }
  if (typeof issue.number === "number") {
    parsed.number = issue.number;
  }
  const issueKey =
    issueKeyFor({
      repo: parsed.repo,
      number: parsed.number,
    }) ?? (typeof issue.issueKey === "string" ? issue.issueKey : undefined);
  if (issueKey) {
    parsed.issueKey = issueKey;
  }
  if (issue.kind === "github" || issue.kind === "featuremania") {
    parsed.kind = issue.kind;
  }
  if (Array.isArray(issue.childKeys) && issue.childKeys.every((key) => typeof key === "string")) {
    parsed.childKeys = issue.childKeys;
  }
  if (issue.groupMode === "parent" || issue.groupMode === "merge") {
    parsed.groupMode = issue.groupMode;
  }
  return parsed;
}

function asRepoList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((repo) => typeof repo === "string")) {
    return null;
  }
  return value;
}

function asIssueList(value: unknown): KanbanIssue[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map(asIssue).filter((issue): issue is KanbanIssue => issue !== null);
}

export function emptyNamedBoard(id: string, name: string): NamedLiveBoard {
  return { id, name, selectedRepos: [], issues: [], groups: [] };
}

export function nextBoardId(boards: NamedLiveBoard[]): string {
  let n = boards.length + 1;
  const ids = new Set(boards.map((board) => board.id));
  while (ids.has(`board-${n}`)) {
    n += 1;
  }
  return `board-${n}`;
}

function asNamedBoard(value: unknown): NamedLiveBoard | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  if (typeof record.name !== "string" || record.name.length === 0) {
    return null;
  }
  const selectedRepos = asRepoList(record.selectedRepos);
  const issues = asIssueList(record.issues);
  if (!selectedRepos || !issues) {
    return null;
  }
  const groups = Array.isArray(record.groups)
    ? record.groups.map(asGroup).filter((group): group is LiveGroup => group !== null)
    : [];
  return { id: record.id, name: record.name, selectedRepos, issues, groups };
}

function withActiveMirrors(snapshot: {
  githubUserId: string;
  activeBoardId: string;
  boards: NamedLiveBoard[];
}): LiveBoardSnapshot {
  const active =
    snapshot.boards.find((board) => board.id === snapshot.activeBoardId) ?? snapshot.boards[0];
  return {
    v: 3,
    githubUserId: snapshot.githubUserId,
    activeBoardId: active?.id ?? DEFAULT_BOARD_ID,
    boards: snapshot.boards.length > 0 ? snapshot.boards : [emptyNamedBoard(DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME)],
    selectedRepos: active?.selectedRepos ?? [],
    issues: active?.issues ?? [],
  };
}

function parseSnapshot(value: unknown): LiveBoardSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.githubUserId !== "string" || record.githubUserId.length === 0) {
    return null;
  }
  if (record.v === 1) {
    const selectedRepos = asRepoList(record.selectedRepos);
    const issues = asIssueList(record.issues);
    if (!selectedRepos || !issues) {
      return null;
    }
    return withActiveMirrors({
      githubUserId: record.githubUserId,
      activeBoardId: DEFAULT_BOARD_ID,
      boards: [
        {
          id: DEFAULT_BOARD_ID,
          name: DEFAULT_BOARD_NAME,
          selectedRepos,
          issues,
          groups: [],
        },
      ],
    });
  }
  if (record.v !== 2 && record.v !== 3) {
    return null;
  }
  if (!Array.isArray(record.boards)) {
    return null;
  }
  const boards = record.boards
    .map(asNamedBoard)
    .filter((board): board is NamedLiveBoard => board !== null);
  if (boards.length === 0) {
    return null;
  }
  const activeBoardId =
    typeof record.activeBoardId === "string" && boards.some((board) => board.id === record.activeBoardId)
      ? record.activeBoardId
      : boards[0].id;
  return withActiveMirrors({
    githubUserId: record.githubUserId,
    activeBoardId,
    boards,
  });
}

export function readLiveBoardSnapshot(): LiveBoardSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LIVE_BOARD_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }
    return parseSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeLiveBoardSnapshot(input: {
  githubUserId: string;
  selectedRepos: string[];
  issues: KanbanIssue[];
  activeBoardId?: string;
  boards?: NamedLiveBoard[];
  name?: string;
  groups?: LiveGroup[];
}): void {
  if (typeof window === "undefined") {
    return;
  }
  const issues = input.issues.map(asIssue).filter((issue): issue is KanbanIssue => issue !== null);
  const stored = readLiveBoardSnapshot();
  const existing = stored?.githubUserId === input.githubUserId ? stored : null;
  const fallback = existing ?? {
    githubUserId: input.githubUserId,
    activeBoardId: DEFAULT_BOARD_ID,
    boards: [emptyNamedBoard(DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME)],
  };
  const activeBoardId = input.activeBoardId ?? fallback.activeBoardId;
  const sourceBoards = input.boards ?? fallback.boards;
  const boards = (sourceBoards.length > 0 ? sourceBoards : fallback.boards).map((board) => {
    if (board.id !== activeBoardId) {
      return board;
    }
    return {
      ...board,
      selectedRepos: input.selectedRepos,
      issues,
      groups: input.groups ?? board.groups ?? [],
      name: input.name ?? board.name,
    };
  });
  const persisted = {
    v: 3 as const,
    githubUserId: input.githubUserId,
    activeBoardId,
    boards,
  };
  window.localStorage.setItem(LIVE_BOARD_SNAPSHOT_KEY, JSON.stringify(persisted));
}

export function wipeLiveBoardSnapshot(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(LIVE_BOARD_SNAPSHOT_KEY);
}
