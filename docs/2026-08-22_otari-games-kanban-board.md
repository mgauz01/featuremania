# Otari Games: Multi-Repo Kanban Board Implementation Plan

> **For the executing agent:** Use the **pi-subagents** skill to implement this plan task-by-task. Each task runs in a fresh subagent with two-stage review (spec compliance, then code quality), per the pi-subagents workflow.

**Goal:** A web app that lets users sign in with GitHub, select repositories, and view a unified Kanban board of all issues across those repos — scored by "actual work being done" — with all LLM calls routed through Otari for the Otari Games competition (deadline: Mon Aug 31).

**Architecture:** Next.js 14 (App Router) + TypeScript frontend with a Python FastAPI backend that runs the Otari gateway as a sidecar. A cron job scrapes GitHub GraphQL API, computes scores, and stores them in SQLite. Otari handles all LLM calls, routing, guardrails, and budget enforcement. The app is a single Vercel/Railway deploy with the gateway accessible only from the backend.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Shadcn/ui, Python FastAPI, SQLite (via SQLModel), Otari gateway (Docker), GitHub GraphQL API, open-weights models via Ollama/llamafile, Playwright for e2e, pytest for backend, vitest for frontend.

---

## Task 1: Project Bootstrap

**Objective:** Scaffold the monorepo with frontend, backend, and shared config.

**Files:**
- Create: `package.json` (root workspaces)
- Create: `apps/web/package.json`
- Create: `apps/api/pyproject.toml`
- Create: `apps/api/src/main.py`
- Create: `apps/api/tests/test_health.py`
- Create: `.env.example`

**Step 1: Write failing test**

```python
# apps/api/tests/test_health.py
from fastapi.testclient import TestClient
from src.main import app

def test_health():
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.main'`

**Step 3: Write minimal implementation**

```python
# apps/api/src/main.py
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_health.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/ package.json apps/web/package.json .env.example
git commit -m "feat: bootstrap monorepo with FastAPI health check"
```

---

## Task 2: GitHub SSO (Backend)

**Objective:** Backend issues a session after GitHub OAuth flow.

**Files:**
- Create: `apps/api/src/auth/github.py`
- Create: `apps/api/src/auth/session.py`
- Create: `apps/api/tests/test_auth.py`
- Modify: `apps/api/src/main.py` (mount auth router)

**Step 1: Write failing test**

```python
# apps/api/tests/test_auth.py
def test_github_login_redirect():
    from src.auth.github import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(router, prefix="/auth")
    client = TestClient(app)
    resp = client.get("/auth/github", follow_redirects=False)
    assert resp.status_code == 302
    assert "github.com/login/oauth/authorize" in resp.headers["location"]
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_auth.py -v`
Expected: FAIL — import error

**Step 3: Write minimal implementation**

```python
# apps/api/src/auth/github.py
import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
import httpx

router = APIRouter()

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI", "http://localhost:8000/auth/github/callback")

@router.get("/github")
def github_login():
    return RedirectResponse(
        f"https://github.com/login/oauth/authorize?client_id={GITHUB_CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=read:user,repo"
    )

@router.get("/github/callback")
async def github_callback(code: str):
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
            },
        )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="OAuth failed")
        # In real code: fetch user, create session, return session cookie
        return {"access_token": access_token}
```

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_auth.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/auth/ apps/api/tests/test_auth.py apps/api/src/main.py
git commit -m "feat: GitHub SSO backend flow"
```

---

## Task 3: GitHub SSO (Frontend)

**Objective:** Next.js login button that initiates OAuth and stores session.

**Files:**
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/components/LoginButton.tsx`
- Create: `apps/web/middleware.ts`

**Step 1: Write failing test**

```typescript
// apps/web/__tests__/login.test.tsx
import { render, screen } from '@testing-library/react'
import LoginPage from '@/app/login/page'

test('renders GitHub login button', () => {
  render(<LoginPage />)
  expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument()
})
```

**Step 2: Run test to verify failure**

Run: `cd apps/web && pnpm test -- login.test.tsx`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Use `next-auth` with GitHub provider. Configure `GITHUB_ID` and `GITHUB_SECRET` in `.env.local`. The login page renders a button that calls `signIn('github')`.

**Step 4: Run test to verify pass**

Run: `cd apps/web && pnpm test -- login.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: GitHub SSO frontend with next-auth"
```

---

## Task 4: Multi-Repo Board Data Model

**Objective:** SQLite schema for boards, repos, issues, scores, and timelines.

**Files:**
- Create: `apps/api/src/models/board.py`
- Create: `apps/api/src/models/issue.py`
- Create: `apps/api/src/models/score.py`
- Create: `apps/api/tests/test_models.py`

**Step 1: Write failing test**

```python
# apps/api/tests/test_models.py
def test_board_model():
    from src.models.board import Board
    board = Board(name="Otari Board", repos=["mozilla-ai/otari"])
    assert board.name == "Otari Board"
    assert len(board.repos) == 1
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_models.py -v`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```python
# apps/api/src/models/board.py
from sqlmodel import SQLModel, Field

class Board(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    repos: list[str] = Field(default_factory=list)  # stored as JSON

# apps/api/src/models/issue.py
class Issue(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    board_id: int = Field(foreign_key="board.id")
    repo: str
    number: int
    title: str
    body: str
    comments_count: int
    reactions_count: int
    subtasks_count: int
    commits_on_closing_prs: int
    last_activity_at: str
    status: str  # backlog | triaged | in_progress | in_review | done
    score: float
    created_at: str
    updated_at: str
```

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_models.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/models/ apps/api/tests/test_models.py
git commit -m "feat: board and issue data models"
```

---

## Task 5: GitHub MCP Server + GraphQL Fallback Scraper

**Objective:** Fetch issues + linked PRs + commits. Primary: GitHub MCP server via Otari. Fallback: direct GraphQL if MCP is unavailable or unstable.

**Files:**
- Create: `apps/api/src/scraper/mcp_client.py`
- Create: `apps/api/src/scraper/github_graphql.py`
- Create: `apps/api/src/scraper/cron.py`
- Create: `apps/api/tests/test_scraper.py`

**Step 1: Write failing test**

```python
# apps/api/tests/test_scraper.py
def test_mcp_client_available():
    from src.scraper.mcp_client import MCPClient
    client = MCPClient()
    assert hasattr(client, 'list_issues')

def test_graphql_fallback_query():
    from src.scraper.github_graphql import ISSUES_QUERY
    assert "commits" in ISSUES_QUERY
    assert "comments" in ISSUES_QUERY
    assert "reactions" in ISSUES_QUERY
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_scraper.py -v`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```python
# apps/api/src/scraper/mcp_client.py
class MCPClient:
    """Primary scraper: GitHub MCP server via Otari."""
    def __init__(self):
        self.enabled = True  # set False if MCP unavailable

    def list_issues(self, owner: str, repo: str) -> list[dict]:
        # MCP call to GitHub server
        # Returns issues with comments, reactions, linked PRs
        pass

    def get_pr_commits(self, owner: str, repo: str, pr_number: int) -> int:
        pass

# apps/api/src/scraper/github_graphql.py
ISSUES_QUERY = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $cursor, states: [OPEN, CLOSED]) {
      nodes {
        number
        title
        body
        comments { totalCount }
        reactions { totalCount }
        timelineItems(itemTypes: [CROSS_REFERENCE_EVENT], first: 20) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  commits { totalCount }
                  state
                }
              }
            }
          }
        }
        updatedAt
        createdAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""

def fetch_issues_graphql(owner: str, repo: str, token: str) -> list[dict]:
    # Direct GraphQL fallback
    pass

# apps/api/src/scraper/cron.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler

async def scrape_repo(owner: str, repo: str):
    try:
        # Try MCP first
        mcp = MCPClient()
        issues = mcp.list_issues(owner, repo)
    except Exception:
        # Fallback to GraphQL
        issues = fetch_issues_graphql(owner, repo, token=os.getenv("GITHUB_TOKEN"))
    # Upsert to SQLite
    ...

scheduler = AsyncIOScheduler()
scheduler.add_job(scrape_all_repos, 'interval', minutes=15)
```

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_scraper.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/scraper/ apps/api/tests/test_scraper.py
git commit -m "feat: GitHub MCP scraper with GraphQL fallback"
```

---

## Task 6: Score Computation

**Objective:** Compute "worked-on" score per issue using log + decay formula.

**Files:**
- Create: `apps/api/src/scoring/engine.py`
- Create: `apps/api/tests/test_scoring.py`

**Step 1: Write failing test**

```python
# apps/api/tests/test_scoring.py
def test_score_calculation():
    from src.scoring.engine import compute_score
    score = compute_score(commits=10, subtasks=5, comments=20, days_since=5)
    assert score > 0
    # More commits should increase score
    assert compute_score(commits=20, subtasks=5, comments=20, days_since=5) > score
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_scoring.py -v`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```python
# apps/api/src/scoring/engine.py
import math
from datetime import datetime, timezone

def compute_score(commits: int, subtasks: int, comments: int, days_since: int) -> float:
    base = 0.5 * math.log1p(commits) + 0.3 * math.log1p(subtasks) + 0.2 * math.log1p(comments)
    decay = 0.5 ** (days_since / 30)  # half-life 30 days
    return base * decay
```

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_scoring.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/scoring/ apps/api/tests/test_scoring.py
git commit -m "feat: score computation with log decay"
```

---

## Task 7: Otari Gateway Integration

**Objective:** All LLM calls route through Otari with guardrails, budgets, and routing.

**Files:**
- Create: `apps/api/src/otari/client.py`
- Create: `apps/api/src/otari/config.py`
- Create: `apps/api/tests/test_otari.py`

**Step 1: Write failing test**

```python
# apps/api/tests/test_otari.py
def test_otari_client_initialization():
    from src.otari.client import OtariClient
    client = OtariClient(base_url="http://localhost:8000/v1", api_key="gw-...")
    assert client.base_url == "http://localhost:8000/v1"
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_otari.py -v`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```python
# apps/api/src/otari/client.py
from openai import OpenAI

class OtariClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    def summarize(self, text: str) -> str:
        resp = self.client.chat.completions.create(
            model="mzai:deepseek-ai/DeepSeek-V4-Pro",
            messages=[{"role": "user", "content": f"Summarize this GitHub issue in one line:\n{text}"}],
        )
        return resp.choices[0].message.content
```

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_otari.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/otari/ apps/api/tests/test_otari.py
git commit -m "feat: Otari gateway client with OpenAI SDK"
```

---

## Task 8: LLM Enrichment Pipeline

**Objective:** Enrich each issue with LLM summary, category, and "worked on?" judgment.

**Files:**
- Create: `apps/api/src/enrichment/pipeline.py`
- Create: `apps/api/tests/test_enrichment.py`

**Step 1: Write failing test**

```python
# apps/api/tests/test_enrichment.py
def test_enrichment_pipeline():
    from src.enrichment.pipeline import EnrichmentPipeline
    pipeline = EnrichmentPipeline(otari_client=mock_client)
    result = pipeline.enrich(issue={"title": "Add dark mode", "body": "Please add dark mode..."})
    assert "summary" in result
    assert "category" in result
    assert "worked_on" in result
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_enrichment.py -v`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

The pipeline calls Otari for each issue:
1. **Guardrails** check for prompt injection in the issue body.
2. **Routing** sends easy issues to a cheap open-weights model, hard ones to a frontier model.
3. **Summary** via DeepSeek-V3.
4. **Category** via Llama 3.3 70B.
5. **Worked on?** via frontier model with linked PR data.
6. **Budgets** enforced per job.

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_enrichment.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/enrichment/ apps/api/tests/test_enrichment.py
git commit -m "feat: LLM enrichment pipeline through Otari"
```

---

## Task 9: Kanban Board UI

**Objective:** Next.js board showing issues as cards, sortable by score.

**Files:**
- Create: `apps/web/app/board/[id]/page.tsx`
- Create: `apps/web/components/KanbanBoard.tsx`
- Create: `apps/web/components/IssueCard.tsx`
- Create: `apps/web/components/ScoreBadge.tsx`
- Create: `apps/web/components/RepoPicker.tsx`

**Step 1: Write failing test**

```typescript
// apps/web/__tests__/kanban.test.tsx
import { render, screen } from '@testing-library/react'
import KanbanBoard from '@/components/KanbanBoard'

test('renders board with issues', () => {
  const issues = [{ id: 1, title: 'Test issue', score: 5.2 }]
  render(<KanbanBoard issues={issues} />)
  expect(screen.getByText('Test issue')).toBeInTheDocument()
})
```

**Step 2: Run test to verify failure**

Run: `cd apps/web && pnpm test -- kanban.test.tsx`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

The board has columns: Backlog, Triaged, In Progress, In Review, Done. Cards show title, repo, score badge, and LLM summary. Filters by repo, category, staleness. Sort by score descending.

**Step 4: Run test to verify pass**

Run: `cd apps/web && pnpm test -- kanban.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: Kanban board UI with score sorting"
```

---

## Task 10: Live Routing Dashboard

**Objective:** Show which model answered each enrichment, cost, and guardrail events.

**Files:**
- Create: `apps/web/components/RoutingDashboard.tsx`
- Create: `apps/api/src/otari/usage.py`
- Create: `apps/api/tests/test_usage.py`

**Step 1: Write failing test**

```python
# apps/api/tests/test_usage.py
def test_usage_tracking():
    from src.otari.usage import UsageTracker
    tracker = UsageTracker()
    tracker.log(model="deepseek-v3", tokens=100, cost=0.001, feature="summary")
    assert len(tracker.events) == 1
```

**Step 2: Run test to verify failure**

Run: `cd apps/api && uv run pytest tests/test_usage.py -v`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

The dashboard polls `/v1/usage` from Otari and displays a live feed: model used, tokens, cost, feature, and any guardrail blocks.

**Step 4: Run test to verify pass**

Run: `cd apps/api && uv run pytest tests/test_usage.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/components/RoutingDashboard.tsx apps/api/src/otari/usage.py apps/api/tests/test_usage.py
git commit -m "feat: live routing dashboard with usage tracking"
```

---

## Task 11: Deployment

**Objective:** Deploy the app publicly so a colleague can test it.

**Files:**
- Create: `apps/web/vercel.json`
- Create: `apps/api/Dockerfile`
- Create: `docker-compose.yml`

**Step 1: Write minimal implementation**

Deploy frontend to Vercel. Deploy backend + Otari gateway to Railway or Render using Docker Compose. Set environment variables for GitHub OAuth, Otari keys, and provider keys.

**Step 2: Verify deployment**

- [ ] Frontend loads at public URL
- [ ] GitHub SSO works end-to-end
- [ ] Repo picker fetches real repos
- [ ] Board shows real issues with scores
- [ ] At least one colleague has tested it

**Step 3: Commit**

```bash
git add apps/web/vercel.json apps/api/Dockerfile docker-compose.yml
git commit -m "feat: deployment config for Vercel + Railway"
```

---

## Task 12: Otari Log & Polish

**Objective:** Write the detailed Otari log and polish the app.

**Files:**
- Create: `OTARI_LOG.md`
- Modify: `README.md`

**Step 1: Write the Otari log**

For each feature used, follow the template:
> "I've used feature X to achieve Y. I found M, N, and O easy to use and struggled to achieve A, B, and C because D, E, and F."

Features to log:
- Routing (learned router for cheap vs frontier)
- Guardrails (prompt injection on issue bodies)
- MCP Servers (GitHub MCP server)
- Budgets (per-job spend limits)
- Code Execution (score computation sandbox)
- Web Search Enablement (context lookup)
- Open-weights models: DeepSeek-V3, Llama 3.3 70B, Qwen 2.5 72B

**Step 2: Polish**

- [ ] Dark mode
- [ ] Loading states
- [ ] Error handling
- [ ] Mobile responsive
- [ ] "Why this score?" tooltip on each card

**Step 3: Commit**

```bash
git add OTARI_LOG.md README.md
git commit -m "docs: Otari log and README polish"
```

---

## Files Likely to Change

- `apps/api/src/main.py` — FastAPI app entry
- `apps/api/src/auth/github.py` — OAuth flow
- `apps/api/src/models/*.py` — SQLModel schemas
- `apps/api/src/scraper/*.py` — GitHub GraphQL scraper
- `apps/api/src/scoring/engine.py` — score formula
- `apps/api/src/otari/*.py` — Otari client, usage tracking
- `apps/api/src/enrichment/pipeline.py` — LLM enrichment
- `apps/web/app/board/[id]/page.tsx` — board page
- `apps/web/components/*.tsx` — UI components
- `apps/web/app/api/auth/[...nextauth]/route.ts` — auth

## Tests / Validation

- Backend: `cd apps/api && uv run pytest -v`
- Frontend: `cd apps/web && pnpm test`
- E2E: `pnpm dlx playwright test`
- Otari integration: manual test with `curl` to `/v1/chat/completions` through the gateway

## Risks, Tradeoffs, and Open Questions

| Risk | Mitigation |
|---|---|
| GitHub API rate limits | GraphQL pagination + caching in SQLite; cron every 15 min not on page load |
| Otari gateway complexity | Start with standalone mode; add otari.ai connected mode only if time permits |
| Open-weights model setup | Use Ollama for local dev; llamafile for demo if Ollama is too heavy |
| Scope creep | The 20% time rule is explicit; cut features in this order: Web Search → Code Execution → MCP → Budgets → Guardrails → Routing |
| Score bias | Normalize per-repo; decay for staleness; document the formula in the UI |

## Open Questions

1. Which open-weights models are actually available via Otari's provider list? (Need to check the dashboard.)
2. Does Otari's Code Execution sandbox have the Python packages needed for score computation? (May need to pre-compute in the scraper instead.)
3. Is the GitHub MCP server stable enough for the demo? We use it as primary with automatic fallback to direct GraphQL if it fails or is unavailable.

---

**Next step:** Execute this plan using **pi-subagents**. Each task gets a fresh subagent with two-stage review (spec compliance, then code quality). Package managers: **pnpm** for all JS/TS (never npm), **uv** for Python.
