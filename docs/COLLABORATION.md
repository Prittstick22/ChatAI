# Team workflow: four developers

| Owner | Exclusive main directory | Primary role |
|---|---|---|
| A | apps/chat-api | FastAPI, SQLite, WebSocket, poll and event endpoints |
| B | apps/ai-service | Model calls, summary, semantic search, extraction |
| C | apps/web | Chat layout, composer, topic digest, search and suggestions |
| D | docs, scripts, .github | Integration smoke checks, seed data, demo, video and submission |

**One branch per ticket**: `feat/04-websocket` or `fix/search-timeout`. Keep PRs below ~300 lines where feasible. Don't commit directly to `main` after initial scaffolding. Tag the responsible ticket in PR description: `Closes #N`.

## Shared API contract
- Chat API at port 8000; AI port 8001; web port 5173.
- Agree and freeze JSON payloads for `GET /messages`, `POST /messages`, `WS /ws`, `GET /insights`, `POST /polls`, `POST /votes`, `GET /events/{id}.ics` as a *team*. Not all scaffold endpoints are guaranteed implemented yet.
- Frontend should centralise backend URL and hide fetch calls behind a typed client; mock pending endpoints until available.
- AI engineer develops independently using sample conversation fixtures; chat engineer uses AI fallback responses during integration.
- Only owner A changes database schema; only owner C modifies shared app styles. D reviews cross-service integration.

## Conflict avoidance
1. Agree data types and naming in the first 30 minutes.
2. Reserve files per owner and edit others' files only with their approval.
3. Do small PRs; review/merge chronologically.
4. Rebase onto main before resolving conflicts, don't force-push shared branches.
5. If you need a contract change, notify everyone and update documentation before code.

## Timeline / release gate
- 09:30–10:00 setup and API contract freeze
- 10:00–11:30 real-time chat vertical slice
- 11:30–12:30 AI summary and semantic search integration
- 12:30–13:30 event and poll nudges
- 13:30–14:15 end-to-end QA
- **14:15 feature freeze**; record video
- 15:10–15:40 submit, leaving buffer before **16:00 BST** deadline

## Definition of done
Ticket acceptance criteria pass, feature demo works in Docker, errors handled, README updated if setup changed, no API keys or raw private conversations committed.
