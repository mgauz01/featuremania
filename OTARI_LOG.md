# Otari log

Honest notes from Featuremania against the code that actually shipped. Each feature uses the required template. This is not a marketing write-up.

## Routing

I've used feature Routing to achieve cheap vs specialized enrichment in `EnrichmentPipeline.route()`. I found the static heuristic (body length, commit count, comment count), `OtariConfig` model overrides, and the easy-route default of DeepSeek-V3.2 easy to use and struggled to achieve a learned Otari router, a true frontier vs cheap split, and per-task specialized models for summary/category/judgment because `route()` only returns `"easy"` or `"hard"`, hard jobs only swap category to Kimi-K2.6 while summary and judgment stay DeepSeek-V3.2, and nothing in this repo calls an Otari router API.

Easy means `commits_on_closing_prs == 0`, `comments_count < 5`, and `len(body) <= 800`; those jobs send summary, category, and judgment to `mzai:deepseek-ai/DeepSeek-V3.2`. Hard means any of commits > 0, comments >= 5, or body longer than 800 characters; category then uses `mzai:moonshotai/Kimi-K2.6`.

## Guardrails

I've used feature Guardrails to achieve prompt-injection blocking on Otari chat calls. I found `OtariConfig.guardrails()`, `extra_body` on `OtariClient.complete()` / `summarize()`, and the env defaults `OTARI_GUARDRAIL_PROFILE=prompt-injection` plus `OTARI_GUARDRAIL_MODE=block` easy to use and struggled to achieve live proof that Otari honors those keys, a dedicated issue-body injection test against the hosted gateway, and surfacing real blocks on the board because `/v1/usage` can return an empty local tracker, there is no recorded live guardrail event in this tree, and we never asserted a blocked completion in CI.

`OtariClient._extra_body()` always sends `{"guardrails": [{"profile": ..., "mode": ...}], "session_label": ...}`. Defaults are prompt-injection / block when no config is passed.

## MCP Servers

I've used feature MCP Servers to achieve a documented primary/fallback scrape shape, not a working GitHub MCP integration. I found the `GITHUB_MCP_URL` enabled flag, the `try/except` around `MCPClient().list_issues()` in `scrape_repo`, and the GraphQL fallback easy to use and struggled to achieve listing issues via MCP, fetching PR commits via MCP, and talking to a GitHub MCP server through Otari because `apps/api/src/scraper/mcp_client.py` is a stub: when `GITHUB_MCP_URL` is unset it raises "unavailable", and when it is set `list_issues` / `get_pr_commits` still raise "GitHub MCP server is not wired yet". Production scrape traffic is GitHub GraphQL.

## Budgets

I've used feature Budgets to achieve labeled spend attribution on each completion. I found `OTARI_BUDGET_USER`, passing that value as both the OpenAI `user` field and `extra_body.session_label`, and `EnrichmentPipeline`'s `job_label` easy to use and struggled to achieve a hard dollar cap, stopping a job when spend exceeds a limit, and per-job enforcement in code because there is no budget remaining check, no `OTARI_BUDGET_DOLLARS` (or similar) read, and labels are truncated to 255 characters and sent onward with no local accounting.

Hosted Otari is expected to attribute spend via `session_label`; this repo does not enforce a numeric cap.

## Code Execution

I've used feature Code Execution to achieve issue scores with local Python math, not Otari's sandbox. I found `log1p` on commits/subtasks/comments, the 30-day half-life `0.5 ** (days/30)`, and `score_issue()` writing `issue["score"]` easy to use and struggled to achieve running that formula inside Otari code execution, depending on sandbox packages, and treating scoring as an LLM tool because `apps/api/src/scoring/engine.py` is ordinary CPython called from the scraper, and the Otari code-execution sandbox was not used.

Formula: `0.5 * log1p(commits) + 0.3 * log1p(subtasks) + 0.2 * log1p(comments)`, times `0.5 ** (days_since / 30)`.

## Web Search Enablement

I've used feature Web Search Enablement to achieve nothing in this repository. I found keeping scrape on GitHub GraphQL, keeping enrichment prompts on title/body/counts, and not inventing a search sidecar easy to use and struggled to achieve extra issue context from the web, related-doc lookup, and live evidence in summaries because web search is not implemented: no Otari web_search flag, no tool call, no search client.

## Open-weights models

I've used feature open-weights models to achieve DeepSeek-V3.2 and Kimi-K2.6 on enrichment routes. I found the `mzai:` model ids, `OTARI_SUMMARY_MODEL` / `OTARI_CATEGORY_MODEL` / `OTARI_JUDGMENT_MODEL` env overrides, and defaulting easy jobs to DeepSeek-V3.2 easy to use and struggled to achieve Llama 3.3 70B, Qwen 2.5 72B, and a runtime catalog check because those two names exist in the plan only — they are not wired in `pipeline.py` or `config.py`, and this repo does not probe Otari's model list at startup.

Wired models:

- `mzai:deepseek-ai/DeepSeek-V3.2` (default summary and judgment; all three tasks on the easy route)
- `mzai:moonshotai/Kimi-K2.6` (default category on the hard route)

Not wired: Llama 3.3 70B, Qwen 2.5 72B.
