# ChatAI — Hackathon execution plan (Saturday 10 October 2026, BST)

**Submission deadline: 16:00.** Work backwards from recording and upload time. **Hard feature freeze 14:15.** Every milestone has a visible proof, not just merged code.

## Updated team ownership — distributed admin + engineering

- **Naweed / nm-04 (9 issues):** #1 #2 #3 #4 #15 #16 #23 #32 (core messaging) plus #31 (architecture and privacy notes). **Own** `apps/chat-api/`, core `apps/web/src/main.tsx`, `docs/ARCHITECTURE.md`.
- **Jin / JCYuhei (9 issues):** #8 #9 #10 #11 #12 #13 #14 #33 (AI development) plus #28 (technical pitch/storyboard). **Own** `apps/ai-service/`, `docs/DEMO.md` draft.
- **Vera / vmalkova (9 issues):** #5 #6 #7 #17 #18 #19 #20 #22 (actions UI/integration) plus #29 (record the 3-minute video and verify file). **Own** `apps/web/src/features/` and demo media assets; negotiate needed chat endpoints with Naweed.
- **Dev / Prittstick22 (8 issues):** #24 #25 #26 #27 #30 (API contract, system smoke/E2E, seed data oversight and submission), **plus new engineering #34 #35 #36** (automated API integration tests, reproducible fixture seeding CLI, GitHub Actions). **Own** `tests/`, `scripts/`, `fixtures/`, `.github/workflows/`, `docs/API_CONTRACT.md`, `docs/TIMELINE.md`.

**This is fair by workstream, not just ticket totals.** Naweed's messaging platform remains a critical path. No teammate waits for another's implementation: AI works against JSON fixtures; UI actions use typed mock data until chat API is ready; Dev tests against published contracts. Help across boundaries through PR review, not simultaneous edits.

### Admin duties shared
| Duty | Owner | Backup |
|---|---|---|
| Architecture / technical depth slides | Naweed | Dev |
| AI explanation and presentation script | Jin | Dev |
| Recording, exporting and playback check | Vera | Jin |
| API contract, check-ins, final integration and Devpost submission | Dev | Vera |
| Running own feature's tests and filing blockers | Every developer | Dev |

### Merge-collision controls
1. At 09:45 freeze endpoint payload shapes in `docs/API_CONTRACT.md`. Contract changes require Dev's approval.
2. **One file, one primary owner**: Naweed owns `apps/web/src/main.tsx`; Vera puts components in `apps/web/src/features/` and sends Naweed a small import contract. Jin owns the AI service. Dev owns test and CI directories.
3. Avoid editing the same source file on separate branches. Prefer dependency PRs: first API contract, then backend endpoints, then component integration.
4. Small PRs merged in sequence after CI; one person reviews every PR. Rebase before merging. After 14:15 allow only critical fixes.
5. Every 30-minute check-in: done (PR + demonstrated result), next, blocker, risk (green/amber/red).

## Milestones, checkpoints and acceptance criteria

| Time BST | Gate | Proof of completion | If missed |
|---|---|---|---|
| 09:30–09:45 | **M0 — setup** | Each laptop clones, env variables are set, Docker starts or direct local startup works | Fix environment; avoid diverging |
| 09:45–10:00 | **M1 — contract freeze** | Agree POST /messages, WS event shape, AI /digest /search /suggest JSON and React component slots | No new endpoint shape without group agreement |
| 10:00–11:00 | **M2 — messaging vertical slice** | Two browser tabs share new messages instantly; refresh retains history | Temporarily disable AI panels; nm-04 and Dev fix chat |
| 11:00–11:30 | **M3 — shared baseline** | `uv run scripts/smoke_test.py` passes core checks; PR merged; Jin and Vera can call services | Fix CORS, host, imports; don't add scope |
| 11:30–12:30 | **M4 — AI vertical slice** | 20+ seeded messages summarised; 3 semantic queries return source messages | Fall back to digest only, keep text search |
| 12:30–13:30 | **M5 — intelligent action** | An event suggestion appears and user can accept/download ICS; poll optional | Keep manually created poll or ICS fallback |
| 13:30–14:15 | **M6 — integration gate** | Rehearse complete demo on clean app twice, no unhandled errors | Kill lowest value features |
| **14:15** | **FEATURE FREEZE** | All surviving features merged to main, tag/release candidate recorded | No new functionality or architecture swaps |
| 14:15–14:45 | **M7 — final QA** | Two browsers, AI failure fallback, seed data and recording flow tested | Fix only demo-blockers |
| 14:45–15:10 | **M8 — video ready** | Working 3-minute recording exported and viewed end to end | Use stable pre-recorded fallback walkthrough |
| 15:10–15:40 | **M9 — submitted** | Devpost accepts video and public repository; team checks confirmation | Upload early; submit with fewer features |
| 15:40–16:00 | **Buffer** | Verify submission and GitHub public access | No nonessential changes |

## Fallback A: same-machine, two browser sessions (recommended)
1. `docker compose up --build` on one laptop.
2. Open `http://localhost:5173` in normal browser and incognito window.
3. Select different demo users in each tab.
4. Send message from either session; confirm it appears in both without refreshing.
5. Show catch-up/search/action in one session.

This requires no external hosting and is the **default** demo backup.

## Fallback B: two different machines on the same LAN
This is an **optional integration task, not guaranteed out of the box**. Vite, chat API and WebSocket URL must point to an accessible host. The current frontend hardcodes `http://localhost:8000`, which must be made configurable. Host and client must use matching API hostname, CORS origins and firewall rules. Avoid publicly exposing unauthenticated endpoints. Verify network reachability ahead of demo. If connecting fails, return to fallback A immediately.

## Fallback C: cloud demo (optional)
Only if local M5 has passed by 13:30. Deploy React to Vercel and FastAPI WebSocket server to Railway or similar. Do not migrate SQLite to Supabase under time pressure; a cloud backend needs proper persistent storage before relying on it. Keep the local Docker demo working throughout.

## Check-in format (every 30 minutes)
Each person reports in the team chat:
- **Done:** working behaviour with link to PR or screenshot
- **Next:** one concrete task for next 30 minutes
- **Blocker:** API mismatch, code review, model key, CORS, failed test
- **Risk:** green / amber / red

Dev owns integration and decides what gets cut. No last-minute merge without Dev reviewing the effect on the recorded demo.

## Merge protocol
- One issue per short-lived branch; PRs to main.
- nm-04 owns `apps/web/src/main.tsx`; Vera builds independent components in `apps/web/src/features/`; Dev coordinates imports.
- Jin's API returns documented JSON and tested fixtures, not ad hoc natural language where structured output is expected.
- Before merging, test the branch, inspect GitHub Actions and run smoke tests if it touches the API.
- No credentials, real private chats, or generated runtime databases committed.
