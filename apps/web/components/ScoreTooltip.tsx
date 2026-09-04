import MathBlock from "@/components/MathBlock";
import { formatWorkIndex } from "@/components/ScoreBadge";

// Mirrors compute_score in apps/api/src/scoring/engine.py.
const COMMIT_WEIGHT = 0.5;
const SUBTASK_WEIGHT = 0.3;
const COMMENT_WEIGHT = 0.2;
const HALF_LIFE_DAYS = 30;

const DEFINITION_LATEX = String.raw`\begin{aligned}
\text{work} &= ${COMMIT_WEIGHT}\ln(1+c) + ${SUBTASK_WEIGHT}\ln(1+s) + ${COMMENT_WEIGHT}\ln(1+m) \\[4pt]
\text{recency} &= 0.5^{\,d/${HALF_LIFE_DAYS}} \\[4pt]
\text{score} &= \text{work} \times \text{recency}
\end{aligned}`;

const DEFINITION_LABEL =
  "Work equals 0.5 times the natural log of 1 plus commits, plus 0.3 times the natural log " +
  "of 1 plus subtasks, plus 0.2 times the natural log of 1 plus comments. Recency equals 0.5 " +
  "raised to the power of days divided by 30. Score equals work times recency.";

type ScoreTooltipProps = {
  score: number;
  commits?: number;
  subtasks?: number;
  comments?: number;
  lastActivityAt?: string;
  reason?: string;
};

function formatValue(value: number | undefined): string {
  return value === undefined ? "not on this card" : String(value);
}

function formatQuantity(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function joinFacts(facts: string[]): string {
  if (facts.length < 2) {
    return facts[0] ?? "the available work signals";
  }
  return `${facts.slice(0, -1).join(", ")}, and ${facts[facts.length - 1]}`;
}

function scoreMeaning(score: number): string {
  const index = formatWorkIndex(score);
  return (
    `${index} is a work index, not a percent complete and not a done mark. ` +
    "A quiet ticket sits near 0. A typical active ticket sits near 1. " +
    "The board only uses this number to rank how much recent work has touched the card. " +
    "There is no finish line at 1.00, so a value above 1 just means more work than typical."
  );
}

function deterministicExplanation(
  commits: number | undefined,
  subtasks: number | undefined,
  comments: number | undefined,
): string {
  const facts = [
    commits === undefined
      ? null
      : formatQuantity(commits, "closing-PR commit", "closing-PR commits"),
    subtasks === undefined ? null : formatQuantity(subtasks, "subtask", "subtasks"),
    comments === undefined ? null : formatQuantity(comments, "comment", "comments"),
  ].filter((fact): fact is string => fact !== null);
  return (
    `It comes from ${joinFacts(facts)}, reduced by the ` +
    `${HALF_LIFE_DAYS}-day half-life since the last activity.`
  );
}

/**
 * Splits the score back into the two factors the backend multiplied together.
 * The recency multiplier is recovered as score / work rather than from a clock,
 * so the panel stays consistent with whatever the backend stored.
 */
function substitutedMath(
  score: number,
  commits: number | undefined,
  subtasks: number | undefined,
  comments: number | undefined,
): { latex: string; label: string } | null {
  if (commits === undefined || subtasks === undefined || comments === undefined) {
    return null;
  }
  const work =
    COMMIT_WEIGHT * Math.log1p(commits) +
    SUBTASK_WEIGHT * Math.log1p(subtasks) +
    COMMENT_WEIGHT * Math.log1p(comments);
  if (work <= 0) {
    return null;
  }
  const recency = score / work;
  const show = (value: number) => value.toFixed(3);
  return {
    latex: String.raw`\begin{aligned}
\text{work} &= ${COMMIT_WEIGHT}\ln(1+${commits}) + ${SUBTASK_WEIGHT}\ln(1+${subtasks}) + ${COMMENT_WEIGHT}\ln(1+${comments}) = ${show(work)} \\[4pt]
\text{recency} &= ${show(recency)} \\[4pt]
\text{score} &= ${show(work)} \times ${show(recency)} = ${show(score)}
\end{aligned}`,
    label:
      `For this card, work equals ${show(work)}, recency equals ${show(recency)}, ` +
      `and score equals ${show(score)}.`,
  };
}

export default function ScoreTooltip({
  score,
  commits,
  subtasks,
  comments,
  lastActivityAt,
  reason,
}: ScoreTooltipProps) {
  const explanation = reason?.trim()
    ? reason.trim()
    : deterministicExplanation(commits, subtasks, comments);
  const substituted = substitutedMath(score, commits, subtasks, comments);
  return (
    <div className="score-tooltip-body">
      <p className="score-meaning">{scoreMeaning(score)}</p>
      <p className="score-reason">{explanation}</p>
      <details className="score-formula-fold">
        <summary>Formula details</summary>
        <MathBlock latex={DEFINITION_LATEX} label={DEFINITION_LABEL} />
        <p className="score-formula-legend">
          c = commits on the pull requests that closed this issue, s = subtasks, m = comments,
          d = days since the last activity.
        </p>
        {substituted ? (
          <MathBlock latex={substituted.latex} label={substituted.label} />
        ) : null}
        <dl className="score-facts">
          <dt>Work index</dt>
          <dd>{formatWorkIndex(score)}</dd>
          <dt>Raw value</dt>
          <dd>{score.toFixed(3)}</dd>
          <dt>Commits</dt>
          <dd>{formatValue(commits)}</dd>
          <dt>Subtasks</dt>
          <dd>{formatValue(subtasks)}</dd>
          <dt>Comments</dt>
          <dd>{formatValue(comments)}</dd>
          <dt>Last activity</dt>
          <dd>{lastActivityAt ? lastActivityAt : "not on this card"}</dd>
        </dl>
      </details>
    </div>
  );
}
