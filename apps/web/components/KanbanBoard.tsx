"use client";

import { useMemo, useState } from "react";
import IssueCard from "@/components/IssueCard";
import RepoPicker from "@/components/RepoPicker";

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
};

type KanbanBoardProps = {
  issues: KanbanIssue[];
};

const COLUMNS: { id: IssueStatus; title: string }[] = [
  { id: "backlog", title: "Backlog" },
  { id: "triaged", title: "Triaged" },
  { id: "in_progress", title: "In Progress" },
  { id: "in_review", title: "In Review" },
  { id: "done", title: "Done" },
];

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function columnFor(issue: KanbanIssue): IssueStatus {
  const status = issue.status ?? "backlog";
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

export default function KanbanBoard({ issues }: KanbanBoardProps) {
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
      <div className="kanban-columns">
        {COLUMNS.map((column) => (
          <section key={column.id} className="kanban-column" aria-label={column.title}>
            <header className="kanban-column-header">
              <h2>{column.title}</h2>
              <span>{issuesByColumn[column.id].length}</span>
            </header>
            {issuesByColumn[column.id].map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
