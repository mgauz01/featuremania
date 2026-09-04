"use client";

import type { NamedLiveBoard } from "@/lib/live-board-snapshot";

export type AppRailIdentity = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type AppRailProps = {
  identity: AppRailIdentity;
  boards: NamedLiveBoard[];
  activeBoardId: string;
  draftName: string;
  onDraftNameChange: (value: string) => void;
  onRename: () => void;
  onSelectBoard: (id: string) => void;
  onNewBoard: () => void;
  onDeleteBoard: (id: string) => void;
};

function identityLabel(identity: AppRailIdentity): string {
  return identity.name?.trim() || identity.email?.trim() || "GitHub account";
}

export default function AppRail({
  identity,
  boards,
  activeBoardId,
  draftName,
  onDraftNameChange,
  onRename,
  onSelectBoard,
  onNewBoard,
  onDeleteBoard,
}: AppRailProps) {
  const label = identityLabel(identity);
  return (
    <aside className="app-rail" aria-label="Boards and profile">
      <section className="app-rail-profile">
        {identity.image ? (
          // Session avatar URLs come from GitHub SSO; next/image is not in this layout.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="app-rail-avatar" src={identity.image} alt="" width={32} height={32} />
        ) : (
          <span className="app-rail-avatar app-rail-avatar-fallback" aria-hidden="true">
            {label.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <p className="app-rail-name">{label}</p>
          {identity.email && identity.name ? (
            <p className="app-rail-meta">{identity.email}</p>
          ) : null}
        </div>
      </section>
      <nav className="app-rail-boards" aria-label="Your boards">
        {boards.map((board) => (
          <div key={board.id} className="app-rail-board-row">
            <button
              type="button"
              className="app-rail-board-select"
              aria-current={board.id === activeBoardId ? "page" : undefined}
              onClick={() => onSelectBoard(board.id)}
            >
              {board.name}
            </button>
            <button
              type="button"
              className="app-rail-delete"
              aria-label={`Delete ${board.name}`}
              onClick={() => onDeleteBoard(board.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="app-rail-new" onClick={onNewBoard}>
          New board
        </button>
      </nav>
      <form
        className="app-rail-rename"
        onSubmit={(event) => {
          event.preventDefault();
          onRename();
        }}
      >
        <label>
          Rename board
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            maxLength={40}
          />
        </label>
        <button type="submit">Save name</button>
      </form>
    </aside>
  );
}
