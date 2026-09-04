# Code Context

Planning target: enrich `docs/plans/2026-08-26-002-feat-live-board-client-snapshot-plan.md` (patterns for client snapshot). Product: last successful live-board issues + last repo pick in browser storage, keyed to signed-in GitHub user. Load / top Refresh still full Otari. Failed Refresh keeps painted board. Sign out / missing session / other GitHub user hide+wipe. No GitHub token or Otari keys in snapshot.

Settled: instant paint only; browser snapshot not `GET /v1/boards/live`; keep until success or sign-out; bind to GitHub user.

## Files Retrieved

1. `apps/web/components/LiveBoard.tsx` (lines 67–233) — load, refresh, fail, paint
2. `apps/web/components/KanbanBoard.tsx` (lines 7–26) — `KanbanIssue` / `IssueStatus`
3. `apps/web/components/ThemeToggle.tsx` (lines 5–35) — localStorage pattern
4. `apps/web/app/layout.tsx` (lines 10–26) — header + theme boot script
5. `apps/web/components/LoginButton.tsx` (lines 1–10) — `signIn` only, no `signOut`
6. `apps/web/app/api/auth/[...nextauth]/route.ts` (lines 5–41) — JWT `accessToken`, session passthrough
7. `apps/web/types/next-auth.d.ts` (lines 1–8) — JWT `accessToken` only
8. `apps/web/lib/github-bff.ts` (lines 33–75) — BFF attaches token; 401 without it
9. `apps/web/app/api/live/load/route.ts` (lines 1–14) — POST → `/v1/boards/load`, 180s
10. `apps/web/app/api/live/preflight/route.ts`, `repos/route.ts`, `progress/route.ts` — BFF proxies
11. `apps/web/__tests__/live-board.test.tsx` (lines 158–284) — Refresh + fail hides board
12. `apps/web/__tests__/auth-token.test.ts` (lines 16–26) — token stays off client session
13. `apps/web/__tests__/login.test.tsx` (lines 11–20) — sign-in callback `/board/1`
14. `README.md` (lines 32–33) — test commands
15. `docs/plans/2026-08-26-002-feat-live-board-client-snapshot-plan.md` (lines 22–40, 132–143) — contract

## Key Code

### LiveBoard load / refresh / fail (must change for R6)

State: `issues: KanbanIssue[] | null`, `selected: string[]`, `loading`, `loadError`. Mount: preflight then repos; **no snapshot restore**.

`runLoad` POSTs `/api/live/load` with `{ repos: selected }`. **On any non-OK or catch: `setIssues(null)`** — hides Kanban. Success: `asIssue` filter then `setIssues(next)`.

Refresh is a second `runLoad` on the same `selected`. Button is **below** picker, **only when `issues` is truthy** (under Kanban in DOM after picker).

```146:176:apps/web/components/LiveBoard.tsx
  const runLoad = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/live/load", { method: "POST", ... });
      ...
      if (!response.ok) {
        setIssues(null);
        setLoadError(errorMessage(payload, "Otari is not configured or did not answer"));
        return;
      }
      ...
    } catch (error) {
      setIssues(null);
      ...
    } finally {
      setLoading(false);
    }
  }, [selected]);
```

```223:231:apps/web/components/LiveBoard.tsx
      {issues ? (
        <>
          <button type="button" onClick={() => void runLoad()} disabled={loading}>
            Refresh
          </button>
          <KanbanBoard issues={issues} />
```

Timeout client-side: `TimeoutError` / `AbortError` → “Load timed out. Try fewer repositories.” BFF already maps that to 504 JSON `detail`.

### Theme localStorage (copy this shape, different key)

- Key: `"theme"` (`ThemeToggle.tsx:5`).
- Values: `"light" | "dark"` only.
- Read in `useEffect` after mount; write on toggle.
- Layout injects **inline boot script** so first paint matches storage (`layout.tsx:10`): `localStorage.getItem("theme")` + `data-theme`. Wrapped in `try/catch`.
- Snapshot should follow: named key, parse+validate, `try/catch`, **never store tokens**. Do **not** reuse `"theme"`.

### NextAuth session / JWT

JWT (server-only cookie): `JwtToken = JWT & { accessToken?: string }`. Persist on first OAuth `account.access_token`; later jwt calls keep it (`persistGitHubAccessToken`). Default JWT also has `sub` (GitHub numeric id as string) from NextAuth — **not declared** in `next-auth.d.ts`.

Session callback returns `session` unchanged — **does not copy `accessToken`** (test: `auth-token.test.ts:23-26`). Default client `session.user` is `name`, `email`, `image` only. **No `login`, no GitHub id, no `SessionProvider` in the tree** (grep: no `useSession` / `signOut` / `SessionProvider`).

**Constraint for “bind to GitHub user”:** client cannot today read a stable GitHub identity. Implementer must add a **non-secret** field (prefer `sub` / GitHub user id, or `login`) via `session` callback **without** putting `accessToken` on the session. Email is a weak key (GitHub users can hide email).

Token must stay in JWT; BFF uses `getToken` (`github-bff.ts:39-43`). Snapshot must not include `accessToken`.

### LoginButton / header / Sign out

`LoginButton`: `signIn("github", { callbackUrl: "/board/1" })` only. Used on `/login`.

Root header (`layout.tsx:21-23`): **only `ThemeToggle`**. No Sign out. Plan R8 wants Sign out in site header while signed in (`plan.md` mermaid ~line 121).

Need: `SessionProvider` in layout (or a small providers wrapper) + `signOut` from `next-auth/react`. Wipe snapshot **before or as** `signOut` so the next user cannot paint.

### BFF live routes

| Route | File | Upstream |
|---|---|---|
| GET `/api/live/preflight` | `preflight/route.ts` | `/v1/preflight` |
| GET `/api/live/repos` | `repos/route.ts` | `/v1/repos` |
| POST `/api/live/load` | `load/route.ts` | `/v1/boards/load`, `LOAD_TIMEOUT_MS` 180_000 |
| GET `/api/live/progress` | `progress/route.ts` | `/v1/boards/load/progress` |

**No** web proxy for `GET /v1/boards/live`. Settled: do not add one for restore.

`proxyLiveApi`: 401 `{ error: "Not signed in" }` if JWT missing `accessToken`. Bearer forwarded to FastAPI only.

### KanbanIssue

```14:26:apps/web/components/KanbanBoard.tsx
export type KanbanIssue = {
  id: number;
  title: string;
  score: number;
  repo?: string;
  summary?: string;
  category?: string;
  status?: IssueStatus;
  last_activity_at?: string;
  commits_on_closing_prs?: number;
  subtasks_count?: number;
  comments_count?: number;
};
```

`LiveBoard.asIssue` is the allow-list for JSON → typed issue. Snapshot persist/restore should reuse this (titles/summaries/scores/pick OK; no extra token fields).

### Tests (web)

`apps/web/__tests__/live-board.test.tsx`: picker CSS; hide picker if preflight not ready; Load paints issues; **Refresh posts second `/api/live/load`**; progress while in flight; **timeout abort hides board** (`queryByText("Add dark mode")` not in that test — timeout test expects no leftover issue titles from that run, board not painted because fail-from-empty). **No test today that fail-after-success keeps Kanban** — current code would fail such a test.

`login.test.tsx`: Sign in with GitHub → `/board/1`.

`auth-token.test.ts`: scopes + token persist + session does not copy token.

Add/extend: restore from storage keyed by user; failed Refresh keeps issues; sign-out wipe; other-user wipe; snapshot JSON has no `accessToken`/Otari keys.

### Test commands

- Frontend: `CI=true pnpm --filter web test` (script: `vitest run --passWithNoTests` in `apps/web/package.json`). Filter: `pnpm --filter web exec vitest run __tests__/live-board.test.tsx`.
- API: `cd apps/api && uv run pytest -q` (snapshot work is **web-only**; API `GET /v1/boards/live` stays unused).

## Architecture

Browser `LiveBoard` → Next BFF `/api/live/*` → FastAPI with GitHub bearer from NextAuth JWT. Otari only on API. Client never sees Otari keys or (today) the GitHub token on `session`.

Restore path (new): localStorage (or similar) `{ githubUserId, repos, issues }` → paint + re-check boxes **before** waiting on load. Preflight still runs; can still block **new** pick (`preflightBlocksPicker`). Restore must not POST load automatically.

Fail path (change): stop `setIssues(null)` when a board is already painted; still set `loadError`. First-load fail from empty can stay empty.

Identity: compare stored key to session GitHub id; mismatch or unsigned → hide Kanban, `removeItem`.

## Start Here

Open `apps/web/components/LiveBoard.tsx`. All restore, keep-on-fail, top Refresh, and snapshot write/wipe land here. Then `layout.tsx` + new sign-out control + session callback for a client-safe GitHub user id. Copy storage hygiene from `ThemeToggle.tsx` / theme boot script.

## Constraints / risks / open questions

- **Settled “browser snapshot not GET /v1/boards/live” still holds.** API live board is one named SQLite row, not per GitHub user (`plan.md` decision + `apps/api/src/main.py` GET `/v1/boards/live`).
- **Settled “bind to GitHub user” can work but is not implemented.** Needs SessionProvider + session field (`id`/`login`/`sub`) without `accessToken`. If that field is omitted, implementer cannot honor hide-and-wipe vs another account on the same browser.
- **No `signOut` today.** Header is theme-only.
- **Refresh placement:** currently inside `{issues ? …}` after picker; plan wants it at **top** of live board whenever painted (including in-flight).
- **First-load fail vs refresh fail:** today’s tests encode hide-on-fail from empty; R6 only requires keep when already painted.
- Snapshot schema: persist `selected` + sanitized `KanbanIssue[]` + user key. Do not persist JWT.

## Supervisor coordination

None needed. No blocker that contradicts settled decisions; identity gap is an implementation prerequisite, not a product reversal.
