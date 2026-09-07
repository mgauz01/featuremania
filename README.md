# FeatureMania

FeatureMania shows GitHub issues on a Kanban board. It scores each issue from commits, subtasks, and comments. Otari writes a short summary and a category.

## Run

Copy the GitHub keys from `.env.example` into `apps/web/.env.local`. Copy the Otari key into `.env`. Then run `./run.sh`.

### Docker

Need Docker Desktop or an equivalent engine. Use the same two env files. Do not run `./run.sh` at the same time: both paths publish ports 3000 and 8000.

```sh
docker compose up --build
```

Then open http://localhost:3000/login. GitHub OAuth still returns to that localhost URL.

Compose sets the Next server `API_ORIGIN` to `http://api:8000` so the web container can reach FastAPI. Native `./run.sh` still uses `http://localhost:8000` from `apps/web/.env.local`. Leave that file on localhost for native runs; Compose overrides the value inside the container.

If a host edit does not show after refresh, restart the web container.
