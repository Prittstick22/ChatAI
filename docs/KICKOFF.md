# Hackathon kickoff checklist

## Before 09:30
- [ ] Everyone accepts collaborator invites, clones the repo and opens [setup](SETUP.md).
- [ ] Assign named people to AI, action integrations and QA; nm-04 owns base messaging.
- [ ] Team agrees on IDEs, Node 20+, Python 3.11+, Docker Desktop, Git credentials.
- [ ] Share model billing budget and issue each developer **their own key** through a secure channel. Never paste secrets in issues or commits.
- [ ] Agree to use only synthetic demo data.
- [ ] Verify hackathon rules on pre-existing scaffolding and AI-generated code.

## 09:30–10:00: common baseline
1. Clone main; copy .env.example to .env.
2. Start Docker Desktop and run `docker compose up --build`.
3. Open web and the API docs.
4. In another terminal run `python scripts/smoke_test.py`.
5. Record failures in #24's implementation checklist; do not assume the scaffold has already passed CI.
6. Freeze payload formats listed in [API contract](API_CONTRACT.md).
7. Have each developer create a feature branch from the latest main.

## 10:00–13:30: develop in parallel
- **nm-04:** own apps/chat-api and the base chat UI (apps/web). Deliver two-session messaging first; coordinate UI component boundaries with Actions developer.
- **AI engineer:** own apps/ai-service; test using mock messages and return stable JSON contracts.
- **Actions developer:** add own React components under apps/web/src/features, wire approvals and endpoints via small PRs. Avoid editing nm-04's main app file simultaneously.
- **Integration lead:** verify PRs, run tests, prepare seeded demo conversation and storyboard; require screenshots or runnable evidence.

## Integration gates
- 11:30: two-browser chat works and persists through refresh.
- 12:30: summary and semantic search work with your agreed fixture.
- 13:30: event suggestion and one user-approved action work.
- 14:15: feature freeze; critical bug fixes only.
- 15:10: demonstration recording is complete.
- 15:40: Devpost submission is complete; verify the published entry.
- 16:00 BST: official submission deadline.

## Decide now
- AI output contract: will digest be plain text or JSON with topics/decisions/actions? Prefer structured JSON for cards; update both services together.
- Search corpus: last 100 messages is OK for MVP; use stable message IDs for source links.
- Event flow: detect -> review -> approve -> export ICS (do not silently schedule).
- Deployment: local two-browser demo is safer than last-minute cloud deployment. Use one shared backend only if cross-laptop demo is needed.
- Privacy: no genuine personal messages or secrets.

## Quality and contingency
If a feature breaks, show real-time chat + summary + one smart action. Disable incomplete UI panels instead of showing fake functioning behaviour. Test the final exact demo sequence and record from a clean state. Document which features are prototype, implemented, or future work.
