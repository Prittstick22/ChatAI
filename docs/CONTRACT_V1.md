# Stable v1 cross-service contract — PROPOSED target

**Status:** Target contract for team agreement at 09:45 BST. Current scaffold implements a subset and may have older shapes. Do not falsely assume all routes exist. Dev freezes changes after team approves.

## Existing chat routes :8000 (do not break)
`GET /health` → `{"status":"ok"}`
`GET /messages?room=demo` → array of Message
`POST /messages` JSON `{"user":"Alex","text":"We meet Saturday","room":"demo"}` → 201 Message
`GET /rooms?user=Alex` → rooms visible to Alex
`POST /rooms` JSON `{"name":"Food run","created_by":"Alex","members":["Sam"]}` → 201 Room
`DELETE /rooms/{room}?user=Alex` → `{"deleted":true,"room":"food-run"}`; only the creator of an owned room may permanently delete it. Ownerless legacy rooms cannot be deleted.
`WS /ws` → `{"type":"message","message":Message}` after POST
`GET /digest` → `{"summary":"..."}` (legacy)
`GET /search?query=...` → `{"results":[Message],"mode":"semantic|keyword|keyword-fallback"}`
`GET /suggest` → `{"suggestion":"..."}` (legacy)
`GET /replies?room=demo&user=Sam` → `{"replies":["..."]}`: up to 3 smart replies in Sam's own style (additive). Empty when the newest message is Sam's or AI is down.
`GET /polls`, `POST /polls`, `POST /polls/{id}/votes`; `GET /calendar.ics?title=...&date=YYYYMMDDTHHMMSSZ`.

### Message
```json
{"id":1,"room":"demo","user":"Alex","text":"Meet Saturday at noon","created_at":"2026-10-10T09:45:00+00:00"}
```
Stable id is integer; all clients deduplicate by id. Room defaults to `demo`. WS is currently global rather than room-filtered; use one room for MVP.

### Room memberships

`Room.members` is an additive array of demo identity names. When `members` is provided
to `POST /rooms`, the creator is included automatically, duplicates are removed, and
`GET /rooms?user=...` returns only rooms containing that identity. The submitted list
must contain at least one person other than the creator and may contain up to 100 names.
Older room creation requests that omit `members` remain shared with all demo identities,
as do rooms already present before membership support. There is no account registry or
authentication: the frontend uses the known demo identities and currently online or
previously grouped identities as the selectable contact directory.

Deleting an owned room permanently removes its messages, polls, votes, reactions,
read positions, and membership rows. The chat API broadcasts
`{"type":"room_deleted","room":"food-run"}` to connected clients so every UI
removes the room; reconnecting clients no longer receive it from `GET /rooms`.

## Recommended AI service routes :8001
`POST /digest` body `{"messages":[Message]}`; return `{"summary":"..."}` for compatibility. Optional new `topics` array is additive, not replacement.
`POST /search` body `{"query":"when is the meetup","messages":[Message]}` → `{"results":[Message],"mode":"semantic"}`. Keep original ids.
`POST /suggest` body `{"messages":[Message]}` → `{"suggestion":"..."}` compatibility, optionally add `"proposals":[Proposal]` after agreement.
`POST /replies` body `{"messages":[Message],"user":"Sam","style":["Sam's earlier messages"]}` → `{"replies":["..."]}` (additive). `style` is only for voice; the service never stores it.

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
