# MVP API contract

## Chat service :8000
- `GET /health` → `{"status":"ok"}`
- `GET /messages?room=demo` → `[{"id":1,"user":"Alex","room":"demo","text":"...","created_at":"..."}]`
- `POST /messages` → request `{"user":"Alex","text":"Hello","room":"demo"}`; persisted message.
- `WS /ws` → broadcasts `{"type":"message","message":{...}}` upon HTTP message creation.
- `GET /digest` → `{"summary":"..."}`
- `GET /search?query=...` → `{"results":[...],"mode":"semantic|keyword|keyword-fallback"}`
- `GET /suggest` → `{"suggestion":"..."}`
- `GET /polls` → array of polls.
- `POST /polls` → request `{"question":"...","options":["A","B"]}`
- `POST /polls/{id}/votes` → request `{"user":"Alex","option_index":0}`
- `GET /calendar.ics?title=Meeting&date=20261010T120000Z` → text/calendar ICS.

## AI service :8001
- `GET /health`
- `POST /digest` → `{"messages":[{"user":"Alex","text":"..."}]}` returns summary.
- `POST /search` → `{"query":"...","messages":[...]}` returns ranked messages.
- `POST /suggest` → `{"messages":[...]}` returns one proposed action sentence.

## Known boundaries
No authentication, no per-room WS subscription, no full structured event parser, no AI-generated automatic poll approval flow. Current UI offers a manual poll editor and sample ICS download. These are **next-step tasks** in the issues, not completed capabilities. Enforce user approval before creating any real event or poll.
