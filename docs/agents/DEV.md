# Dev (Prittstick22) — integration engineering agent brief

## Read first
Root `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/CONTRACT_V1.md`, `docs/AGENT_HANDOFFS.md` and `docs/TIMELINE.md`.

## Assigned issues
#24 #25 #26 #27 #30 and development #34 #35 #36.

## Coding deliverables
- `tests/integration/`: black-box API tests for chat persistence, polling, ICS and AI fallback; fail clearly when stack broken. No tests requiring real OpenAI key in CI.
- `fixtures/` and `scripts/`: deterministic 25–40-message synthetic demo seed with a date, agreement, unresolved poll and expected semantic searches.
- `.github/workflows/`: Python syntax, frontend build, API integration test jobs as feasible; no secrets in logs.

## Integration and release
Own the contract freeze at 09:45; review PRs; communicate blockers every half-hour. Merge small PRs after test or manual verification. Naweed owns chat files, Jin AI files, Vera React features; don't directly change their code without handoff. Verify fresh clone and Docker Compose, two browser tabs and AI-down fallback. Feature freeze 14:15.

## Acceptance checklist
Tests invoke the actual public HTTP API; seeded fixture deterministic and clearly synthetic; CI has meaningful failure codes; demo script runs locally; no API keys exposed; Devpost public repo + video submitted before 16:00 BST.

## Fallback
A: single machine with Chrome + incognito on localhost. B: two laptops on LAN after frontend API URL, CORS and firewall verified. C: cloud only if local demo already succeeds. Never risk the local fallback to deploy.
