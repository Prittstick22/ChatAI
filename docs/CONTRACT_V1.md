# Stable v1 cross-service contract — PROPOSED target

**Status:** Target contract for team agreement at 09:45 BST. Current scaffold implements a subset and may have older shapes. Do not falsely assume all routes exist. Dev freezes changes after team approves.

## Existing chat routes :8000 (do not break)
`GET /health` → `{"status":"ok"}`
`GET /messages?room=demo` → array of Message
`POST /messages` JSON `{"user":"Alex","text":"We meet Saturday","room":"demo"}` → 201 Message
`WS /ws` → `{"type":"message","message":Message}` after POST
`GET /digest` → `{"summary":"..."}` (legacy)
`GET /search?query=...` → `{"results":[Message],"mode":"semantic|keyword|keyword-fallback"}`
`GET /suggest` → `{"suggestion":"..."}` (legacy)
`GET /polls`, `POST /polls`, `POST /polls/{id}/votes`; `GET /calendar.ics?title=...&date=YYYYMMDDTHHMMSSZ`.

### Message
```json
{"id":1,"room":"demo","user":"Alex","text":"Meet Saturday at noon","created_at":"2026-10-10T09:45:00+00:00"}
```
Stable id is integer; all clients deduplicate by id. Room defaults to `demo`. WS is currently global rather than room-filtered; use one room for MVP.

## Recommended AI service routes :8001
`POST /digest` body `{"messages":[Message]}`; return `{"summary":"..."}` for compatibility. Optional new `topics` array is additive, not replacement.
`POST /search` body `{"query":"when is the meetup","messages":[Message]}` → `{"results":[Message],"mode":"semantic"}`. Keep original ids.
`POST /suggest` body `{"messages":[Message]}` → `{"suggestion":"..."}` compatibility, optionally add `"proposals":[Proposal]` after agreement.

### Proposed structured Proposal (not yet implemented)
```json
{
  "id":"proposal-msg-17",
  "type":"event",
  "title":"Team meetup",
  "description":"Group agreed to meet",
  "source_message_ids":[17,19],
  "confidence":0.84,
  "needs_confirmation":true,
  "start_at":"2026-10-10T12:00:00+01:00",
  "timezone":"Europe/London",
  "options":null
}
```
For poll proposals, `type:"poll"`, `question:"Where shall we eat?"`, `options:["Pizza","Sushi"]`; event-only fields omitted/null. Never use made-up date defaults. Unknown time → `start_at:null` and UI demands user input.

### Approval flow
AI service suggests a proposal but **does not write to SQLite**. UI asks user for confirmation; approval calls existing `POST /polls` or generates an `.ics` after the time has been verified. No new "approve" backend endpoint is necessary for MVP.

## Error conventions
Unavailable AI: chat API returns a usable fallback; UI indicates degraded mode. Never expose API keys, raw provider errors or stack traces. React should depend on typed `apiClient` wrappers and a configurable base URL; WS uses the matching host/protocol (http→ws, https→wss).

## Contract change protocol
1. Propose exact JSON before editing implementation.
2. Get Dev + affected owner agreement.
3. Make a backward-compatible additive change if possible.
4. Include fixture and request/response test.
