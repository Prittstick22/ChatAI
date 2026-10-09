# Vera (vmalkova) — intelligent action and React feature agent brief

## Read first
Root `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/CONTRACT_V1.md`, `docs/AGENT_HANDOFFS.md`. Inspect existing React code, which currently includes legacy inline digest/search/actions.

## Assigned GitHub issues
#5 #6 #7 #17 #18 #19 #20 #22 plus #29 screen recording.

## Feature boundaries
Build `DigestPanel`, `SearchPanel`, `ActionPanel` under `apps/web/src/features/` with exported props/types. **Do not edit `apps/web/src/main.tsx`**, owned by Naweed. Make self-contained feature CSS if needed. Supply a tiny import-and-props snippet to Naweed.

## Functionality
Catch-up shows topic/decisions/actions where structured fields exist, fallback to summary text otherwise. Search result shows original message text, source sender and optional highlight; do not invent links. Action suggestion card shows event/poll proposal, evidence and confirmation; user may dismiss. Event export via ICS only after confirmation and valid datetime. Poll creation/voting via existing Chat API routes; currently /polls is simple CRUD, not auto-generated. Smart replies are P2.

## Data contracts and implementation
Use typed HTTP client with configurable base URL. Build against fixture Proposal JSON from `docs/CONTRACT_V1.md` until Jin delivers output. Chat API is the gateway; do not call OpenAI directly from browser or embed API keys. For any desired backend change, ask Naweed and Dev first. Jin adds `proposals` field to /suggest; preserve old `suggestion`.

## Acceptance
Panels render without backend using mock data; then integrate real APIs. Buttons execute their advertised action, errors shown clearly, pending indicators, no automatic poll creation or calendar writes. Date/time displayed with timezone; ambiguous times force correction. No extra global CSS conflicts.

## Admin
Own final 3-minute recording and playback check by 15:10. Coordinate demo sequence with Dev, technical narrative with Jin. Keep the local two-tab demo video-ready even if cloud hosting fails.
