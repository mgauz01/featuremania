"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import AppRail from "@/components/AppRail";
import KanbanBoard, { type KanbanIssue } from "@/components/KanbanBoard";
import RoutingDashboard from "@/components/RoutingDashboard";
import {
  DEFAULT_BOARD_ID,
  DEFAULT_BOARD_NAME,
  asIssue,
  emptyNamedBoard,
  nextBoardId,
  readLiveBoardSnapshot,
  selectionKeyFor,
  wipeLiveBoardSnapshot,
  writeLiveBoardSnapshot,
  type NamedLiveBoard,
} from "@/lib/live-board-snapshot";
import {
  applyGroups,
  deconstruct,
  dissolve,
  mergeGroup,
  rejoin,
  type LiveGroup,
} from "@/lib/live-grouping";
import {
  preflightBlocksPicker,
  type LivePreflight,
} from "@/lib/live-preflight";

const OVERLAP_LABELS = ["none", "weak theme", "related", "substantial overlap", "same work"] as const;

type LiveBoardProps = {
  dashboardPollMs?: number;
  defaultBoardName?: string;
};

type LoadPayload = {
  issues?: KanbanIssue[];
  detail?: string;
  warning?: string;
};

function looksLikeHtml(value: string): boolean {
  const head = value.trim().slice(0, 80).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<html");
}

function readableText(value: string, fallback: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || looksLikeHtml(trimmed)) {
    return fallback;
  }
  return trimmed.slice(0, 240);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") {
    return readableText(payload, fallback);
  }
  if (payload && typeof payload === "object") {
    const record = payload as { detail?: unknown; error?: unknown };
    if (typeof record.detail === "string" && record.detail) {
      return readableText(record.detail, fallback);
    }
    if (Array.isArray(record.detail) && record.detail[0]) {
      const first = record.detail[0];
      if (typeof first === "string" && first.trim()) {
        return readableText(first, fallback);
      }
      if (
        first &&
        typeof first === "object" &&
        "msg" in first &&
        typeof first.msg === "string" &&
        first.msg.trim()
      ) {
        return first.msg;
      }
    }
    if (typeof record.error === "string" && record.error) {
      return readableText(record.error, fallback);
    }
  }
  return fallback;
}

export default function LiveBoard({
  dashboardPollMs = 5000,
  defaultBoardName = DEFAULT_BOARD_NAME,
}: LiveBoardProps) {
  const { data: session, status } = useSession();
  const githubUserId = session?.user?.id;
  const [preflight, setPreflight] = useState<LivePreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [issues, setIssues] = useState<KanbanIssue[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressDetail, setProgressDetail] = useState<string | null>(null);
  const [boards, setBoards] = useState<NamedLiveBoard[]>(() => [
    emptyNamedBoard(DEFAULT_BOARD_ID, defaultBoardName),
  ]);
  const [activeBoardId, setActiveBoardId] = useState(DEFAULT_BOARD_ID);
  const [draftName, setDraftName] = useState(defaultBoardName);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [groups, setGroups] = useState<LiveGroup[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [deconstructOpen, setDeconstructOpen] = useState(false);
  const [parentTitle, setParentTitle] = useState("");
  const [overlapOpen, setOverlapOpen] = useState(false);
  const [overlapBusy, setOverlapBusy] = useState(false);
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [overlapResult, setOverlapResult] = useState<{
    overlap_index: number;
    reason: string;
    cited_issue_keys: string[];
  } | null>(null);
  const [mergeTitle, setMergeTitle] = useState("");

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (status !== "authenticated" || !githubUserId) {
      wipeLiveBoardSnapshot();
      setIssues(null);
      setSelected([]);
      setGroups([]);
      setSelectedKeys([]);
      setBoards([emptyNamedBoard(DEFAULT_BOARD_ID, defaultBoardName)]);
      setActiveBoardId(DEFAULT_BOARD_ID);
      setDraftName(defaultBoardName);
      setPickerOpen(true);
      return;
    }
    const snapshot = readLiveBoardSnapshot();
    if (!snapshot) {
      return;
    }
    if (snapshot.githubUserId !== githubUserId) {
      wipeLiveBoardSnapshot();
      setIssues(null);
      setSelected([]);
      setGroups([]);
      setSelectedKeys([]);
      setBoards([emptyNamedBoard(DEFAULT_BOARD_ID, defaultBoardName)]);
      setActiveBoardId(DEFAULT_BOARD_ID);
      setDraftName(defaultBoardName);
      setPickerOpen(true);
      return;
    }
    const active =
      snapshot.boards.find((board) => board.id === snapshot.activeBoardId) ?? snapshot.boards[0];
    setBoards(snapshot.boards);
    setActiveBoardId(snapshot.activeBoardId);
    setSelected(snapshot.selectedRepos);
    setIssues(snapshot.issues.length > 0 ? snapshot.issues : null);
    setGroups(active?.groups ?? []);
    setSelectedKeys([]);
    setDraftName(active?.name ?? defaultBoardName);
    setPickerOpen(snapshot.issues.length === 0);
  }, [status, githubUserId, defaultBoardName]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch("/api/live/preflight");
        const payload = (await response.json()) as LivePreflight & {
          error?: string;
          detail?: string;
        };
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setPreflightError(payload.error ?? payload.detail ?? "Not signed in");
          return;
        }
        setPreflight(payload);
        if (!preflightBlocksPicker(payload)) {
          const reposResponse = await fetch("/api/live/repos");
          const reposPayload = (await reposResponse.json()) as { repos?: string[] };
          if (!cancelled && reposResponse.ok && Array.isArray(reposPayload.repos)) {
            setRepos(reposPayload.repos);
          }
        }
      } catch {
        if (!cancelled) {
          setPreflightError(
            "The API is not running on localhost:8000. Start FastAPI, then refresh.",
          );
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setProgressDetail(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch("/api/live/progress");
        const payload = (await response.json()) as { detail?: string };
        if (!cancelled && typeof payload.detail === "string" && payload.detail) {
          setProgressDetail(payload.detail);
        }
      } catch {
        // Progress is advisory; the load request still owns success or failure.
      }
    };
    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [loading]);

  const persist = useCallback(
    (
      nextBoards: NamedLiveBoard[],
      nextActiveId: string,
      nextSelected: string[],
      nextIssues: KanbanIssue[],
      name?: string,
    ) => {
      if (!githubUserId) {
        return;
      }
      try {
        writeLiveBoardSnapshot({
          githubUserId,
          selectedRepos: nextSelected,
          issues: nextIssues,
          boards: nextBoards,
          activeBoardId: nextActiveId,
          name,
        });
      } catch {
        // Keep the in-memory board when localStorage is unavailable.
      }
    },
    [githubUserId],
  );

  const toggleRepo = (repo: string) => {
    setSelected((current) =>
      current.includes(repo) ? current.filter((item) => item !== repo) : [...current, repo],
    );
  };

  const runLoad = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/live/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: selected }),
      });
      const payload = (await response.json()) as LoadPayload;
      if (!response.ok) {
        setLoadError(errorMessage(payload, "Otari is not configured or did not answer"));
        return;
      }
      const next = Array.isArray(payload.issues)
        ? payload.issues.map(asIssue).filter((issue): issue is KanbanIssue => issue !== null)
        : [];
      const presentKeys = new Set(
        next.map((issue) => issue.issueKey).filter((key): key is string => Boolean(key)),
      );
      const nextGroups = rejoin(groups, presentKeys);
      setIssues(next);
      setGroups(nextGroups);
      setSelectedKeys([]);
      setPickerOpen(false);
      if (typeof payload.warning === "string" && payload.warning) {
        setLoadError(payload.warning);
      }
      const nextBoards = boards.map((board) =>
        board.id === activeBoardId
          ? { ...board, selectedRepos: selected, issues: next, groups: nextGroups }
          : board,
      );
      setBoards(nextBoards);
      persist(nextBoards, activeBoardId, selected, next);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      setLoadError(
        name === "TimeoutError" || name === "AbortError"
          ? "Load timed out. Try fewer repositories."
          : "Otari is not configured or did not answer",
      );
    } finally {
      setLoading(false);
    }
  }, [selected, boards, activeBoardId, persist, groups]);

  const selectBoard = (id: string) => {
    const board = boards.find((item) => item.id === id);
    if (!board) {
      return;
    }
    setActiveBoardId(id);
    setSelected(board.selectedRepos);
    setIssues(board.issues.length > 0 ? board.issues : null);
    setGroups(board.groups ?? []);
    setSelectedKeys([]);
    setDraftName(board.name);
    setPickerOpen(board.issues.length === 0);
    setLoadError(null);
    persist(boards, id, board.selectedRepos, board.issues);
  };

  const addBoard = () => {
    const id = nextBoardId(boards);
    const name = `Board ${boards.length + 1}`;
    const board = emptyNamedBoard(id, name);
    const nextBoards = [...boards, board];
    setBoards(nextBoards);
    setActiveBoardId(id);
    setSelected([]);
    setIssues(null);
    setGroups([]);
    setSelectedKeys([]);
    setDraftName(name);
    setPickerOpen(true);
    setLoadError(null);
    persist(nextBoards, id, [], []);
  };

  const renameBoard = () => {
    const name = draftName.trim() || defaultBoardName;
    const nextBoards = boards.map((board) =>
      board.id === activeBoardId ? { ...board, name } : board,
    );
    setBoards(nextBoards);
    setDraftName(name);
    persist(nextBoards, activeBoardId, selected, issues ?? [], name);
  };

  const deleteBoard = (id: string) => {
    const remaining = boards.filter((board) => board.id !== id);
    const nextBoards =
      remaining.length > 0
        ? remaining
        : [emptyNamedBoard(DEFAULT_BOARD_ID, defaultBoardName)];
    const nextActive =
      nextBoards.find((board) => board.id === activeBoardId) ?? nextBoards[0];
    setBoards(nextBoards);
    setActiveBoardId(nextActive.id);
    setSelected(nextActive.selectedRepos);
    setIssues(nextActive.issues.length > 0 ? nextActive.issues : null);
    setGroups(nextActive.groups ?? []);
    setSelectedKeys([]);
    setDraftName(nextActive.name);
    setPickerOpen(nextActive.issues.length === 0);
    setLoadError(null);
    persist(nextBoards, nextActive.id, nextActive.selectedRepos, nextActive.issues);
  };

  const commitGroups = (nextGroups: LiveGroup[]) => {
    const nextIssues = issues ?? [];
    const nextBoards = boards.map((board) =>
      board.id === activeBoardId
        ? { ...board, selectedRepos: selected, issues: nextIssues, groups: nextGroups }
        : board,
    );
    setGroups(nextGroups);
    setBoards(nextBoards);
    persist(nextBoards, activeBoardId, selected, nextIssues);
  };

  const toggleIssue = (issueKey: string) => {
    setSelectedKeys((current) =>
      current.includes(issueKey)
        ? current.filter((key) => key !== issueKey)
        : [...current, issueKey],
    );
  };

  const paintedIssues = applyGroups(issues ?? [], groups);
  const selectableKeys = paintedIssues
    .map((issue) => selectionKeyFor(issue))
    .filter((key): key is string => Boolean(key));

  const confirmDeconstruct = () => {
    const nextGroups = deconstruct(groups, selectedKeys, parentTitle);
    if (nextGroups === groups) {
      return;
    }
    commitGroups(nextGroups);
    setSelectedKeys([]);
    setParentTitle("");
    setDeconstructOpen(false);
  };

  const requestOverlap = async () => {
    const chosen = (issues ?? []).filter((issue) => {
      const key = selectionKeyFor(issue);
      return Boolean(key && selectedKeys.includes(key));
    });
    setOverlapBusy(true);
    setOverlapError(null);
    setOverlapResult(null);
    setOverlapOpen(true);
    try {
      const response = await fetch("/api/live/overlap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issues: chosen.map((issue) => ({
            issueKey: selectionKeyFor(issue) ?? issue.issueKey,
            title: issue.title,
            summary: issue.summary ?? "",
          })),
        }),
      });
      const text = await response.text();
      let payload: unknown = text;
      try {
        payload = JSON.parse(text) as {
          overlap_index?: number;
          reason?: string;
          cited_issue_keys?: string[];
          detail?: string;
          error?: string;
        };
      } catch {
        payload = text;
      }
      if (response.status === 404) {
        setOverlapError("Overlap is not available. Restart the web app.");
        return;
      }
      if (!response.ok) {
        setOverlapError(errorMessage(payload, "Otari could not score overlap"));
        return;
      }
      const scored =
        payload && typeof payload === "object"
          ? (payload as {
            overlap_index?: number;
            reason?: string;
            cited_issue_keys?: string[];
          })
          : null;
      if (!scored || typeof scored.overlap_index !== "number") {
        setOverlapError("Otari could not score overlap");
        return;
      }
      setOverlapResult({
        overlap_index: scored.overlap_index,
        reason: scored.reason ?? "",
        cited_issue_keys: scored.cited_issue_keys ?? [],
      });
    } catch {
      setOverlapError("Otari could not score overlap");
    } finally {
      setOverlapBusy(false);
    }
  };

  const confirmMerge = () => {
    const nextGroups = mergeGroup(groups, selectedKeys, mergeTitle);
    if (nextGroups === groups) {
      return;
    }
    commitGroups(nextGroups);
    setSelectedKeys([]);
    setMergeTitle("");
    setOverlapOpen(false);
    setOverlapResult(null);
  };

  const blocked = preflight !== null && preflightBlocksPicker(preflight);
  const failText = preflightError
    ?? (blocked ? [preflight?.github_error, preflight?.otari_error].filter(Boolean).join(" ") : null);
  const githubNeedsResignIn = Boolean(blocked && preflight?.github_error && !preflightError);
  const activeName =
    boards.find((board) => board.id === activeBoardId)?.name ?? defaultBoardName;

  return (
    <div className="app-workspace">
      <AppRail
        identity={
          status === "authenticated"
            ? {
              name: session?.user?.name,
              email: session?.user?.email,
              image: session?.user?.image,
            }
            : { name: "GitHub account" }
        }
        boards={boards}
        activeBoardId={activeBoardId}
        draftName={draftName}
        onDraftNameChange={setDraftName}
        onRename={renameBoard}
        onSelectBoard={selectBoard}
        onNewBoard={addBoard}
        onDeleteBoard={deleteBoard}
      />
      <section className="live-board" aria-label="Live GitHub board">
        <h1>{activeName}</h1>
        <p className="board-hint">
          Pick repositories, then load. Columns mirror GitHub. They are not a
          drag-and-drop workflow.
        </p>
        {failText ? (
          <p className="routing-dashboard-error" role="alert">
            {failText}
            {githubNeedsResignIn ? " Sign out and sign in again." : null}
          </p>
        ) : null}
        <p id="otari-inference-hint" className="visually-hidden">
          Calls Otari
        </p>
        {issues ? (
          <button
            type="button"
            className="live-board-refresh btn-inference"
            aria-describedby="otari-inference-hint"
            aria-busy={loading}
            onClick={() => void runLoad()}
            disabled={loading}
          >
            Refresh
          </button>
        ) : null}
        {!preflight && !preflightError ? <p>Checking GitHub and Otari…</p> : null}
        {preflight && !blocked ? (
          <details
            className="live-board-picker-fold"
            open={pickerOpen}
            onToggle={(event) => {
              setPickerOpen(event.currentTarget.open);
            }}
          >
            <summary>Pick repositories</summary>
            <form
              className="live-board-picker"
              onSubmit={(event) => {
                event.preventDefault();
                void runLoad();
              }}
            >
              <fieldset>
                <legend className="visually-hidden">Pick repositories</legend>
                {repos.map((repo) => (
                  <label key={repo} className="kanban-filter-checkbox">
                    <input
                      type="checkbox"
                      aria-label={repo}
                      checked={selected.includes(repo)}
                      onChange={() => toggleRepo(repo)}
                    />
                    {repo}
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                className="btn-inference"
                aria-describedby="otari-inference-hint"
                aria-busy={loading}
                disabled={loading || selected.length === 0}
              >
                Load board
              </button>
            </form>
          </details>
        ) : null}
        {loading ? <p>{progressDetail ?? "Loading issues, scores, and Otari…"}</p> : null}
        {loadError ? (
          <p
            className={issues ? "live-board-warning" : "routing-dashboard-error"}
            role={issues ? "status" : "alert"}
          >
            {loadError}
          </p>
        ) : null}
        {issues ? (
          <>
            <div className="live-board-actions">
              <p>
                {selectedKeys.length === 0
                  ? "Select tickets to deconstruct or consolidate."
                  : `${selectedKeys.length} selected`}
              </p>
              <button
                type="button"
                disabled={selectableKeys.length === 0}
                onClick={() => setSelectedKeys(selectableKeys)}
              >
                Select all
              </button>
              <button
                type="button"
                disabled={selectedKeys.length === 0}
                onClick={() => setSelectedKeys([])}
              >
                Deselect
              </button>
              <button
                type="button"
                disabled={selectedKeys.length < 2}
                onClick={() => {
                  setParentTitle("");
                  setDeconstructOpen(true);
                }}
              >
                Deconstruct
              </button>
              <button
                type="button"
                className="btn-inference"
                aria-describedby="otari-inference-hint"
                aria-busy={overlapBusy}
                disabled={selectedKeys.length < 2 || overlapBusy}
                onClick={() => void requestOverlap()}
              >
                Consolidate
              </button>
            </div>
            <KanbanBoard
              issues={paintedIssues}
              sourceIssues={issues}
              selectedKeys={selectedKeys}
              onToggleSelect={toggleIssue}
              onUndoGroup={(groupId) => commitGroups(dissolve(groups, groupId))}
            />
            <RoutingDashboard pollMs={dashboardPollMs} />
          </>
        ) : null}
        {deconstructOpen ? (
          <div className="score-dialog-backdrop" onClick={() => setDeconstructOpen(false)}>
            <div
              className="score-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="deconstruct-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h4 id="deconstruct-title">Deconstruct into a parent</h4>
              <label className="kanban-filter">
                Parent title
                <input
                  aria-label="Parent title"
                  value={parentTitle}
                  onChange={(event) => setParentTitle(event.target.value)}
                />
              </label>
              <button type="button" disabled={parentTitle.trim().length === 0} onClick={confirmDeconstruct}>
                Create parent
              </button>
              <button type="button" onClick={() => setDeconstructOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {overlapOpen ? (
          <div
            className="score-dialog-backdrop"
            onClick={() => {
              if (!overlapBusy) {
                setOverlapOpen(false);
              }
            }}
          >
            <div
              className="score-dialog score-dialog-stack"
              role="dialog"
              aria-modal="true"
              aria-labelledby="overlap-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h4 id="overlap-title">Consolidate issues</h4>
              {overlapBusy ? <p>Scoring overlap with Otari…</p> : null}
              {overlapError ? (
                <p className="routing-dashboard-error" role="alert">
                  {overlapError}
                </p>
              ) : null}
              {overlapResult ? (
                <>
                  <section className="dialog-block" aria-label="Overlap score">
                    <p className="dialog-score">
                      Overlap {overlapResult.overlap_index}{" "}
                      {OVERLAP_LABELS[overlapResult.overlap_index] ?? "none"}
                    </p>
                  </section>
                  <section className="dialog-block" aria-label="Overlap description">
                    {overlapResult.overlap_index >= 3 ? (
                      <p>Likely worth consolidating.</p>
                    ) : (
                      <p>These issues may not overlap. You can still consolidate.</p>
                    )}
                    {overlapResult.reason ? (
                      <p className="dialog-reason">{overlapResult.reason}</p>
                    ) : null}
                  </section>
                  <section className="dialog-block">
                    <label className="kanban-filter">
                      Consolidated title
                      <input
                        aria-label="Consolidated title"
                        value={mergeTitle}
                        onChange={(event) => setMergeTitle(event.target.value)}
                      />
                    </label>
                  </section>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      disabled={mergeTitle.trim().length === 0}
                      onClick={confirmMerge}
                    >
                      Confirm consolidate
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOverlapOpen(false);
                        setOverlapResult(null);
                        setOverlapError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOverlapOpen(false);
                    setOverlapResult(null);
                    setOverlapError(null);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
