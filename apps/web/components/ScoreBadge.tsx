export function formatWorkIndex(score: number): string {
  return score.toFixed(2);
}

type ScoreBadgeProps = {
  score: number;
  onOpen?: () => void;
};

export default function ScoreBadge({ score, onOpen }: ScoreBadgeProps) {
  const label = formatWorkIndex(score);
  return (
    <button
      type="button"
      className="score-badge"
      aria-label={`Work index ${label}`}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      {label}
    </button>
  );
}
