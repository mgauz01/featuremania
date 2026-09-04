"use client";

import { useMemo, useState } from "react";
import IssueCard from "@/components/IssueCard";
import RepoPicker from "@/components/RepoPicker";
import { selectionKeyFor } from "@/lib/live-board-snapshot";

export type IssueStatus =
  | "backlog"
  | "triaged"
  | "in_progress"
  | "in_review"
  | "done";

export type KanbanIssue = {
  id: number;
  title: string;
  score: number;
  repo?: string;
  summary?: string;
  category?: string;
  status?: IssueStatus;
  last_activity_at?: string;
  commits_on_closing_prs?: number;
  subtasks_count?: number;
  comments_count?: number;
  score_reason?: string;
  number?: number;
  issueKey?: string;
  kind?: "github" | "featuremania";
  childKeys?: string[];
  groupMode?: "parent" | "merge";
};

type KanbanBoardProps = {
  issues: KanbanIssue[];
  sourceIssues?: KanbanIssue[];
  selectedKeys?: string[];
  onToggleSelect?: (issueKey: string) => void;
  onUndoGroup?: (groupId: string) => void;
};

const COLUMNS: { id: IssueStatus; title: string; fromGitHub: string }[] = [
  { id: "backlog", title: "Backlog", fromGitHub: "Open, unassigned, no linked PR" },
  { id: "triaged", title: "Triaged", fromGitHub: "Assigned, or labeled triaged" },
  { id: "in_progress", title: "In Progress", fromGitHub: "Linked PR, or labeled in progress" },
  { id: "in_review", title: "In Review", fromGitHub: "Open PR ready for review" },
  { id: "done", title: "Done", fromGitHub: "Closed on GitHub" },
];

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export function columnFor(issue: KanbanIssue): IssueStatus {
  const status = issue.status;
  if (status !== undefined) {
    switch (status) {
      case "backlog":
      case "triaged":
      case "in_progress":
      case "in_review":
      case "done":
        return status;
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }
  // Stale snapshots omit status. A linked-PR commit count is the same
  // signal the API uses for In Progress, so do not dump those into Backlog.
  if ((issue.commits_on_closing_prs ?? 0) > 0) {
    return "in_progress";
  }
  return "backlog";
}

function isStale(issue: KanbanIssue, now: number): boolean {
  if (!issue.last_activity_at) {
    return false;
  }
  const activityTime = Date.parse(issue.last_activity_at);
  if (Number.isNaN(activityTime)) {
    return false;
  }
  return now - activityTime > STALE_AFTER_MS;
}

function sortByScoreDesc(issues: KanbanIssue[]): KanbanIssue[] {
  return [...issues].sort((left, right) => right.score - left.score);
}

function childrenFor(issue: KanbanIssue, sourceIssues: KanbanIssue[]): KanbanIssue[] {
  if (!issue.childKeys || issue.childKeys.length === 0) {
    return [];
  }
  const byKey = new Map(
    sourceIssues
      .filter((child) => child.issueKey)
      .map((child) => [child.issueKey as string, child]),
  );
  return issue.childKeys
    .map((key) => byKey.get(key))
    .filter((child): child is KanbanIssue => child !== undefined);
}

export default function KanbanBoard({
  issues,
  sourceIssues = issues,
  selectedKeys = [],
  onToggleSelect,
  onUndoGroup,
}: KanbanBoardProps) {
  const [repoFilter, setRepoFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [hideStale, setHideStale] = useState(false);

  const repos = useMemo(
    () =>
      Array.from(
        new Set(issues.map((issue) => issue.repo).filter((repo): repo is string => Boolean(repo))),
      ).sort(),
    [issues],
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          issues
            .map((issue) => issue.category)
            .filter((category): category is string => Boolean(category)),
        ),
      ).sort(),
    [issues],
  );

  const visibleIssues = useMemo(() => {
    const now = Date.now();
    return issues.filter((issue) => {
      if (repoFilter && issue.repo !== repoFilter) {
        return false;
      }
      if (categoryFilter && issue.category !== categoryFilter) {
        return false;
      }
      if (hideStale && isStale(issue, now)) {
        return false;
      }
      return true;
    });
  }, [categoryFilter, hideStale, issues, repoFilter]);

  const issuesByColumn = useMemo(() => {
    const grouped: Record<IssueStatus, KanbanIssue[]> = {
      backlog: [],
      triaged: [],
      in_progress: [],
      in_review: [],
      done: [],
    };
    for (const issue of visibleIssues) {
      grouped[columnFor(issue)].push(issue);
    }
    for (const column of COLUMNS) {
      grouped[column.id] = sortByScoreDesc(grouped[column.id]);
    }
    return grouped;
  }, [visibleIssues]);

  return (
    <section className="kanban">
      <div className="kanban-filters">
        <RepoPicker repos={repos} value={repoFilter} onChange={setRepoFilter} />
        <label className="kanban-filter">
          Category
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="kanban-filter kanban-filter-checkbox">
          <input
            type="checkbox"
            checked={hideStale}
            onChange={(event) => setHideStale(event.target.checked)}
          />
          Hide stale
        </label>
      </div>
      {visibleIssues.length === 0 ? (
        <p className="kanban-empty">
          {issues.length === 0
            ? "No issues to show yet."
            : "No issues match these filters."}
        </p>
      ) : null}
      <p className="kanban-legend">
        Columns follow GitHub. Cards cannot be dragged. Open and unassigned
        with no linked pull request stays in Backlog.
      </p>
      <div className="kanban-columns">
        {COLUMNS.map((column) => (
          <section key={column.id} className="kanban-column" aria-label={column.title}>
            <header className="kanban-column-header">
              <div>
                <h2>{column.title}</h2>
                <p className="kanban-column-rule">{column.fromGitHub}</p>
              </div>
              <span>{issuesByColumn[column.id].length}</span>
            </header>
            <div className="kanban-column-inner">
              {issuesByColumn[column.id].length === 0 ? (
                <p className="kanban-column-empty">None from GitHub</p>
              ) : null}
              {issuesByColumn[column.id].map((issue) => {
                const selectionKey = selectionKeyFor(issue);
                return (
                  <IssueCard
                    key={selectionKey ?? issue.issueKey ?? issue.id}
                    issue={issue}
                    childrenIssues={childrenFor(issue, sourceIssues)}
                    selected={Boolean(selectionKey && selectedKeys.includes(selectionKey))}
                    onToggleSelect={onToggleSelect}
                    onUndoGroup={onUndoGroup}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
