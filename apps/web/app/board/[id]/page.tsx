import LiveBoard from "@/components/LiveBoard";

type BoardPageProps = {
  params: { id: string };
};

export default function BoardPage({ params }: BoardPageProps) {
  return (
    <main>
      <LiveBoard defaultBoardName={`Board ${params.id}`} />
    </main>
  );
}
