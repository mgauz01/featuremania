type ScoreBadgeProps = {
  score: number;
};

export default function ScoreBadge({ score }: ScoreBadgeProps) {
  return (
    <span className="score-badge" aria-label={`Score ${score.toFixed(1)}`}>
      {score.toFixed(1)}
    </span>
  );
}
