# Featuremania

A multi-repo Kanban board for GitHub issues, scored by actual work (commits, subtasks, comments, with a 30-day half-life). Sign in once with GitHub on localhost, pick repositories you can access (public and private), then wait until scrape, scores, Otari summaries, and the routing dashboard are live. Refresh repeats that full load.

Open issues go to Backlog. Closed issues go to Done. Otari enrichment (summary, category) and the usage dashboard run from the Python API only — the browser never holds Otari keys or the GitHub access token.

This repo is a pnpm workspace (`apps/*`) plus a uv-managed FastAPI app. Success for this loop is **local**: `localhost:3000` + `localhost:8000` + hosted Otari. Vercel/Railway files exist from an earlier plan; they are not required.

## Apps

| Path | What it is |
|------|------------|
| `apps/web` | Next.js 14 (App Router): GitHub SSO via NextAuth (`read:user repo read:org`), live board, routing dashboard |
| `apps/api` | FastAPI: GraphQL scrape with the SSO bearer token, scoring, Otari enrichment, `/v1/preflight`, `/v1/repos`, `/v1/boards/load`, `/v1/usage` |

The web app proxies live-loop calls through `/api/live/*` and attaches `Authorization: Bearer` from the NextAuth JWT. `apps/web/next.config.mjs` rewrites `/v1/*` (the dashboard poll) to `API_ORIGIN`.

## Package managers

- JavaScript / TypeScript: **pnpm** (never npm)
- Python: **uv**

```bash
pnpm install
pnpm --filter web dev

cd apps/api && uv sync && uv run uvicorn src.main:app --reload --port 8000
```

Then open `http://localhost:3000/login`, sign in with GitHub, and continue to `/board/1`.

Frontend tests: `CI=true pnpm --filter web test`  
API tests: `cd apps/api && uv run pytest -q`

## Environment (local live loop)

Next.js does **not** load the repo-root `.env`. Put web secrets in `apps/web/.env.local`. Put Otari (and optional unused API OAuth vars) in the repo-root `.env` for FastAPI. The API loads that file (or `apps/api/.env` if present) on startup so local `uv run uvicorn` sees `OTARI_API_KEY` without `--env-file`.

### `apps/web/.env.local`

| Variable | Value |
|----------|--------|
| `GITHUB_ID` | GitHub OAuth App client ID |
| `GITHUB_SECRET` | GitHub OAuth App client secret |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` (required even in dev) |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `API_ORIGIN` | `http://localhost:8000` |

GitHub OAuth App homepage: `http://localhost:3000`  
Authorization callback: **`http://localhost:3000/api/auth/callback/github`**  
The app requests `read:user repo read:org` on that one Sign in. No personal access token. The repo picker lists `mozilla-ai` owned repos first (override with `GITHUB_ORG_LOGINS` in the API `.env`). Public org repos do not need membership. Private org repos need org membership **and** a fresh consent after `read:org` was added — revoke the app at GitHub → Settings → Applications → Authorized OAuth Apps, then sign in again. If mozilla-ai restricts third-party OAuth apps, an org admin must approve this GitHub OAuth App.

### API (repo-root `.env`)

| Variable | Notes |
|----------|--------|
| `OTARI_API_KEY` | **Required.** Preflight and load block until Otari answers. |
| `OTARI_BASE_URL` | Default `https://api.otari.ai/v1` |

Do **not** use `GITHUB_TOKEN` for this loop. Scrape uses the signed-in OAuth bearer. `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` and `http://localhost:8000/auth/github` are a leftover API login and are **not** part of the one-SSO path. Leave `GITHUB_MCP_URL` unset (MCP client is a stub).

See `.env.example` for model/guardrail defaults.

## Docker Compose

`docker-compose.yml` builds the FastAPI service on port 8000 (hosted Otari over HTTPS). Optional `env_file: .env`. Not required for the local `uv run uvicorn` loop.

```bash
docker compose up --build
```
