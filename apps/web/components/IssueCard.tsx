import ScoreBadge from "@/components/ScoreBadge";

type IssueCardProps = {
  issue: {
    id: number;
    title: string;
    score: number;
    repo?: string;
    summary?: string;
  };
};

export default function IssueCard({ issue }: IssueCardProps) {
  return (
    <article className="issue-card">
      <div className="issue-card-header">
        <h3>{issue.title}</h3>
        <ScoreBadge score={issue.score} />
      </div>
      {issue.repo ? <p className="issue-card-repo">{issue.repo}</p> : null}
      {issue.summary ? <p className="issue-card-summary">{issue.summary}</p> : null}
    </article>
  );
}
