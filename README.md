# Featuremania

A multi-repo Kanban board for GitHub issues, scored by actual work (commits, subtasks, comments, with a 30-day half-life). Sign in with GitHub, pick repositories, and view columns from Backlog through Done. LLM enrichment (summary, category, worked-on) goes through Otari from the Python API only — the browser never holds Otari keys.

This repo is a pnpm workspace (`apps/*`) plus a uv-managed FastAPI app.

## Apps

| Path | What it is |
|------|------------|
| `apps/web` | Next.js 14 (App Router) UI: GitHub SSO via NextAuth, Kanban board, live routing dashboard |
| `apps/api` | FastAPI: GitHub OAuth, GraphQL scrape (MCP client is a stub), scoring, Otari enrichment, `/v1/usage` |

Otari stays backend-only. `apps/web/next.config.mjs` rewrites `/v1/*` to `API_ORIGIN` (the FastAPI process). The API calls hosted Otari with `OTARI_API_KEY`. Compose does not run an Otari sidecar.

## Package managers

- JavaScript / TypeScript: **pnpm** (never npm)
- Python: **uv**

```bash
pnpm install
pnpm --filter web dev

cd apps/api && uv sync && uv run uvicorn src.main:app --reload --port 8000
```

Frontend tests: `CI=true pnpm --filter web test`  
API tests: `cd apps/api && uv run pytest -q`

## Environment

Copy `.env.example` and fill in values. Do not commit secrets.

- Root `.env` / API: GitHub OAuth (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`), `GITHUB_TOKEN` for GraphQL scrape, `OTARI_API_KEY`, optional `GITHUB_MCP_URL` (MCP is still unwired even if set).
- `apps/web/.env.local`: Next.js does not load the repo-root `.env`. Set `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, and `API_ORIGIN`.

See `.env.example` for callback URLs and production notes.

## Docker Compose

`docker-compose.yml` builds and publishes the FastAPI service on port 8000. It is API-only (hosted Otari over HTTPS). Optional `env_file: .env`.

```bash
docker compose up --build
```

## Vercel (web)

Set the Vercel project **Root Directory** to `apps/web`. `apps/web/vercel.json` installs from the monorepo root (`pnpm install --frozen-lockfile`) and builds with `pnpm --filter web build`. Configure `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, and `API_ORIGIN` in the Vercel dashboard.

## Railway / Render (API)

Build `apps/api/Dockerfile`. Set the API env vars from `.env.example` (GitHub + Otari). Point Vercel `API_ORIGIN` at that public API host.
