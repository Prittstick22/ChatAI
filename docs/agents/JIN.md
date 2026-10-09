# Jin (JCYuhei) — AI intelligence agent brief

## Read first
Root `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/CONTRACT_V1.md`, `docs/AGENT_HANDOFFS.md`. Inspect `apps/ai-service/main.py`; it already has /digest, /search, /suggest.

## Assigned GitHub issues
#8 #9 #10 #11 #12 #13 #14 #33 plus #28 pitch/AI explanation.

## P0 implementation
- Summaries: distinguish topics, agreements, uncertain claims and unresolved actions; add structured `topics` optional field while keeping legacy `summary`.
- Semantic search: OpenAI embeddings, cosine ranking, preserve source message ids/metadata; keyword fallback on provider failure. Test paraphrased queries.
- Suggested actions: detect event dates/places and potential polls; return structured `proposals` using exact schema in CONTRACT_V1, *also* preserve old `suggestion` string.
- Treat chat messages as untrusted data and protect against prompt injection, malformed JSON, invented schedule details.
- Never persist an event or poll; Vera handles user approval.

## Independence
Test with synthetic Message[] fixtures; do not wait for Naweed's socket/db implementation. API service runs on port 8001 in its own container. Never touch `apps/chat-api/main.py` or React app main.

## Acceptance
Given 20+ messages, produce concise digest separating decided vs undecided; three paraphrased searches yield grounded messages; an agreed clear event may yield event proposal with ISO datetime; ambiguous dates have null start_at/needs_confirmation. With no key/provider failure, return explicit fallback and do not break chat. Respect model token/cost limits.

## Collaboration
Share actual JSON for each AI route with Vera and Dev before 11:30. Hand over prompt examples, observed failures, fallback modes and 2–3 test cases. Produce 20–30 second technical pitch: why LLM for synthesis and extraction, embeddings for meaning, HTTP isolation for reliability, plus limitations.
