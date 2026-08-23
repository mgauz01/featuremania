type ScoreTooltipProps = {
  score: number;
  commits?: number;
  subtasks?: number;
  comments?: number;
  lastActivityAt?: string;
};

function formatCount(label: string, value: number | undefined): string {
  return value === undefined ? `${label}: not on this card` : `${label}: ${value}`;
}

export default function ScoreTooltip({
  score,
  commits,
  subtasks,
  comments,
  lastActivityAt,
}: ScoreTooltipProps) {
  return (
    <details className="score-tooltip">
      <summary>Why this score?</summary>
      <div className="score-tooltip-body">
        <p>
          Formula: 0.5*log1p(commits) + 0.3*log1p(subtasks) + 0.2*log1p(comments),
          times 0.5^(days/30) with a 30-day half-life.
        </p>
        <p>Displayed score: {score.toFixed(1)}</p>
        <p>{formatCount("Commits", commits)}</p>
        <p>{formatCount("Subtasks", subtasks)}</p>
        <p>{formatCount("Comments", comments)}</p>
        <p>
          Last activity: {lastActivityAt ? lastActivityAt : "not on this card"}
        </p>
      </div>
    </details>
  );
}
