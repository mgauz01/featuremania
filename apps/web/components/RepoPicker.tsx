"use client";

type RepoPickerProps = {
  repos: string[];
  value: string;
  onChange: (repo: string) => void;
};

export default function RepoPicker({ repos, value, onChange }: RepoPickerProps) {
  return (
    <label className="kanban-filter">
      Repository
      <select
        aria-label="Filter by repository"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All repos</option>
        {repos.map((repo) => (
          <option key={repo} value={repo}>
            {repo}
          </option>
        ))}
      </select>
    </label>
  );
}
