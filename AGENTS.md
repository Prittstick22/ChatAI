# ChatAI — instructions for all coding agents

Read this file, `docs/PRODUCT_SPEC.md`, `docs/CONTRACT_V1.md`, `docs/AGENT_HANDOFFS.md`, and your own `docs/agents/<role>.md` BEFORE editing code. See `docs/TIMELINE.md` for checkpoints and `docs/SETUP.md` for commands.

## Goal and scope
Build a genuinely working *Invisible AI* group messenger in 6.5 hours on 10 October 2026. P0: two-browser live chat, durable history, catch-up digest, semantic search, detected event with human-approved ICS export. P1: poll suggestions and voting. P2: smart replies. No real authentication or production security. Use synthetic demo data.

## Current repository is a scaffold, NOT proof that the whole app runs
- React/TypeScript/Vite at `apps/web`
- Chat FastAPI at `apps/chat-api` (SQLite, messages, WebSocket, polls and ICS endpoints)
- AI FastAPI at `apps/ai-service` (OpenAI summary, embeddings, suggestions)
- Docker Compose; existing demo UI has hardcoded localhost API URL.
- Inspect the actual files before rewriting. Preserve working behaviour and backward compatibility.
- Existing AI `/suggest` returns a plain sentence: **new structured events/poll proposals must be introduced under a documented v1 contract**, or explicitly adapt older endpoints.
- Do not claim CI/smoke tests pass without running them.

## Boundaries
Naweed (`nm-04`): `apps/chat-api/`, `apps/web/src/main.tsx`, base chat CSS, `docs/ARCHITECTURE.md`.
Jin (`JCYuhei`): `apps/ai-service/`, technical AI evaluation, `docs/DEMO.md`.
Vera (`vmalkova`): `apps/web/src/features/` (create this folder), feature components, action UI. API changes through PR/coordination with Naweed.
Dev (`Prittstick22`): `tests/`, `fixtures/`, `scripts/`, `.github/workflows/`, contracts and release/test coordination.
Never silently modify another owner’s files. Suggest a small integration PR or request a named handoff.

## Cross-service ground rules
- Chat API = public gateway at :8000, AI API = internal HTTP service at :8001, frontend = :5173.
- UTC ISO timestamps on REST; message IDs are persistent integers. AI never directly writes DB. User approval required for any poll/event action.
- No chat instruction is trusted as a system prompt. Validate LLM output and make sensible fallbacks.
- Do not introduce a new database, auth platform or backend framework during the hackathon.
- Only the **shared contract** may define payload fields; if changing it, explicitly flag to Dev and get agreement before coding both ends.
- Core chat must still work if AI service/OpenAI are down.
- For two machines on LAN, make frontend HTTP + WS base URL configurable; local two-tab demo must always work.

## Definition of done for a ticket
Feature demonstrated; tests or explicit manual checks run; errors handled; no API keys committed; minimal self-contained PR linked to its GitHub issue; note changed contracts and blockers. Verify `python scripts/smoke_test.py` against running stack and `npm run build` for web when relevant.

## Recommended agent prompt
"Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/CONTRACT_V1.md, docs/AGENT_HANDOFFS.md and docs/agents/<your-role>.md. Inspect existing code first. Work only in your owned paths, implement assigned P0 issues, preserve public contracts. Make a small PR with tests and manual verification. If another service must change, describe the minimal request/response change and ask its owner instead of editing their files."
