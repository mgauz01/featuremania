import KanbanBoard, { type KanbanIssue } from "@/components/KanbanBoard";
import RoutingDashboard from "@/components/RoutingDashboard";

const SAMPLE_ISSUES: KanbanIssue[] = [
  {
    id: 1,
    title: "Add dark mode",
    score: 8.4,
    repo: "otari-games/featuremania",
    status: "in_progress",
    category: "enhancement",
    summary: "Add a dark-mode setting.",
    last_activity_at: new Date().toISOString(),
  },
  {
    id: 2,
    title: "Fix login redirect",
    score: 6.1,
    repo: "otari-games/api",
    status: "in_review",
    category: "bug",
    summary: "Login should return to the board.",
    last_activity_at: new Date().toISOString(),
  },
  {
    id: 3,
    title: "Document scoring",
    score: 3.2,
    repo: "otari-games/featuremania",
    status: "backlog",
    category: "docs",
    last_activity_at: "2020-01-01T00:00:00.000Z",
  },
  {
    id: 4,
    title: "Triage stale bugs",
    score: 4.5,
    repo: "otari-games/api",
    status: "triaged",
    category: "bug",
  },
  {
    id: 5,
    title: "Ship board v1",
    score: 9.1,
    repo: "otari-games/featuremania",
    status: "done",
    category: "enhancement",
    summary: "Kanban v1 shipped.",
  },
];

type BoardPageProps = {
  params: { id: string };
};

export default function BoardPage({ params }: BoardPageProps) {
  return (
    <main>
      <h1>Board {params.id}</h1>
      <p className="board-hint">
        Sample issues for this demo page. Columns are a horizontal board on
        small screens — scroll sideways. Live routing polls /v1/usage.
      </p>
      <KanbanBoard issues={SAMPLE_ISSUES} />
      <RoutingDashboard />
    </main>
  );
}
