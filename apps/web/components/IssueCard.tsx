import ScoreBadge from "@/components/ScoreBadge";
import ScoreTooltip from "@/components/ScoreTooltip";

type IssueCardProps = {
  issue: {
    id: number;
    title: string;
    score: number;
    repo?: string;
    summary?: string;
    commits_on_closing_prs?: number;
    subtasks_count?: number;
    comments_count?: number;
    last_activity_at?: string;
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
      <ScoreTooltip
        score={issue.score}
        commits={issue.commits_on_closing_prs}
        subtasks={issue.subtasks_count}
        comments={issue.comments_count}
        lastActivityAt={issue.last_activity_at}
      />
    </article>
  );
}
