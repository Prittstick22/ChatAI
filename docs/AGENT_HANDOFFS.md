# Agent-to-agent handoffs and merge-safe implementation order

## Dependencies, not sequential blockers
**Naweed → Vera:** existing chat routes `GET/POST /messages`, `POST /polls`, `POST /polls/{id}/votes`, `GET /calendar.ics`; stable TypeScript Message model and exact prop types for Vera's independent components. Naweed owns `apps/web/src/main.tsx` and imports Vera's exported components only after her PR. Vera may use mock responses to build independently.
**Jin → Vera:** response shape for `summary`, `results` and `proposals`. Mock `Proposal` objects until AI outputs are ready. No AI write to polls or calendar automatically.
**Jin → Naweed:** Chat API calls AI service via HTTP with 12–15s timeout, passes recent messages, preserves fallback. Neither changes the other's code.
**Dev → everyone:** contract and synthetic fixture, integration test, review gate and demo feature cuts.

## Safe work order
1. 09:30–09:45: inspect existing repository, check clean build, agree concrete v1 payloads.
2. 09:45–10:00: establish two browser users and stable chat HTTP/WS flow; Jin starts fixture-driven AI; Vera builds independent cards with mocks; Dev prepares tests.
3. By 11:00: Naweed's core slice available for everyone; smoke test.
4. By 12:30: Jin's AI endpoints ready and contract-verified, Vera integrates cards without touching Naweed's app file.
5. By 13:30: poll/event suggestions wired to user-approved action.
6. 14:15: freeze main; record and submit with buffer.

## React file plan to avoid collisions
- `apps/web/src/main.tsx`: **Naweed only**. Hosts page layout and imports components.
- `apps/web/src/features/DigestPanel.tsx`: Vera.
- `apps/web/src/features/SearchPanel.tsx`: Vera.
- `apps/web/src/features/ActionPanel.tsx`: Vera.
- `apps/web/src/features/types.ts`: Vera, re-export stable public API types aligned with contract.
- `apps/web/src/features/apiClient.ts`: Vera, typed HTTP client (base URL configurable). Coordinate final app import path with Naweed.
- `apps/web/src/style.css`: Naweed only; Vera prefers component-scoped CSS.
- `apps/ai-service/main.py`: Jin only.
- `apps/chat-api/main.py`: Naweed only. Vera requests endpoint changes explicitly.
- `tests/`, `fixtures/`, `scripts/`: Dev only.

## Every handoff should contain
Issue/PR URL, affected endpoint or component, exact request/response example, backwards compatibility note, error cases, one successful manual/API test, and required action from recipient.

## Collision / deadlock responses
- If Vera requires new chat endpoint: agree JSON contract, Naweed implements; Vera mocks it in the meantime.
- If Jin proposes new structured response: preserve older `summary`/`suggestion` field; add `proposals`; Vera consumes optionally.
- If Naweed's chat delayed: Jin and Vera do not wait; continue with fixture/mock development.
- If critical integration fails after 14:15: disable noncritical feature rather than rewrite service boundaries.
