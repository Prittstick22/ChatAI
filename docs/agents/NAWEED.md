# Naweed (nm-04) — core messaging agent brief

## Read first
Root `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/CONTRACT_V1.md`, `docs/AGENT_HANDOFFS.md`, `docs/TIMELINE.md`. Inspect existing `apps/chat-api/main.py` and `apps/web/src/main.tsx`, do not replace blindly.

## Assigned GitHub issues
#1 #2 #3 #4 #15 #16 #23 #32 and #31 architecture/privacy.

## Deliverable by 11:00
Real-time single-room group chat in two browser tabs with distinct demo users. POST saves SQLite record; broadcast via WS; both tabs receive one copy; refreshed page retains history. Provide meaningful loading/error states and reconnect. Chat still works when AI is down.

## Interfaces you own
Chat REST GET/POST messages, WS /ws, database schema, chat main UI, layout and reconnect strategy. Keep payloads compatible with `docs/CONTRACT_V1.md`. Make API URL configurable via `VITE_CHAT_API_URL` (or agreed approach) so local and LAN mode work; for local default use localhost. WS should derive from HTTP URL, switching http→ws and https→wss.

## Vera integration (do not implement her panels)
Reserve feature import slot in React. After Vera provides components, import/export at one controlled integration PR. Ensure `POST /polls`, `POST /polls/{id}/votes`, `GET /calendar.ics` function; those routes already exist in starter and Vera can exercise them. Coordinate any changes, don't overwrite her files.

## Tests & failure cases
- Two tabs send simultaneously; messages ordered, no duplicates, user identity correct.
- Refresh restores history, wrong/empty messages rejected, API outage shows clear error.
- WS disconnect and reconnect works (may refetch for missed messages).
- SQLite DB lives in Docker volume (not committed).
- LAN demo option documented, not required for MVP.
- Architecture/privacy document includes no auth, single instance, in-memory WS scaling limits.

## PR handoff
List routes implemented, demo link/screenshots, exact payload and tests run. If blocked by AI, degrade gracefully rather than stopping chat. No changes in `apps/ai-service/` or Vera's feature folder.
