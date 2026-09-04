"use client";

import { useEffect, useState } from "react";
import type { KanbanIssue } from "@/components/KanbanBoard";
import ScoreBadge from "@/components/ScoreBadge";
import ScoreTooltip from "@/components/ScoreTooltip";

type IssueCardProps = {
  issue: KanbanIssue;
  childrenIssues?: KanbanIssue[];
  selected?: boolean;
  onToggleSelect?: (issueKey: string) => void;
  onUndoGroup?: (groupId: string) => void;
};

export default function IssueCard({
  issue,
  childrenIssues = [],
  selected = false,
  onToggleSelect,
  onUndoGroup,
}: IssueCardProps) {
  const [open, setOpen] = useState(false);
  const titleId = `score-reason-${issue.id}`;
  const isFeaturemania = issue.kind === "featuremania";
  const selectable = Boolean(issue.issueKey && !isFeaturemania && onToggleSelect);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <article className={selected ? "issue-card issue-card-selected" : "issue-card"}>
      <div className="issue-card-header">
        {selectable ? (
          <label className="issue-card-select">
            <input
              type="checkbox"
              aria-label={`Select ${issue.issueKey}`}
              checked={selected}
              onChange={() => {
                if (issue.issueKey && onToggleSelect) {
                  onToggleSelect(issue.issueKey);
                }
              }}
            />
          </label>
        ) : null}
        <h3>{issue.title}</h3>
        {isFeaturemania ? null : (
          <ScoreBadge score={issue.score} onOpen={() => setOpen(true)} />
        )}
      </div>
      {isFeaturemania ? (
        <p className="issue-card-repo">
          {issue.groupMode === "merge" ? "Consolidated in FeatureMania" : "FeatureMania parent"}
        </p>
      ) : issue.repo ? (
        <p className="issue-card-repo">{issue.repo}</p>
      ) : null}
      {issue.summary ? <p className="issue-card-summary">{issue.summary}</p> : null}
      {childrenIssues.length > 0 ? (
        <ul className="issue-card-children">
          {childrenIssues.map((child) => (
            <li key={child.issueKey ?? child.id}>{child.title}</li>
          ))}
        </ul>
      ) : null}
      {isFeaturemania && issue.issueKey && onUndoGroup ? (
        <button type="button" onClick={() => onUndoGroup(issue.issueKey!)}>
          Undo grouping
        </button>
      ) : null}
      {open ? (
        <div className="score-dialog-backdrop" onClick={() => setOpen(false)}>
          <div
            className="score-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id={titleId}>Why this score</h4>
            <ScoreTooltip
              score={issue.score}
              commits={issue.commits_on_closing_prs}
              subtasks={issue.subtasks_count}
              comments={issue.comments_count}
              lastActivityAt={issue.last_activity_at}
              reason={issue.score_reason}
            />
            <button type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
