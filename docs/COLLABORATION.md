# Collaboration rules (current authoritative version)

**Agent entry:** [AGENTS.md](../AGENTS.md). **Actual ownership:** [Timeline](TIMELINE.md). **API contract:** [CONTRACT_V1](CONTRACT_V1.md). **Handoffs:** [AGENT_HANDOFFS](AGENT_HANDOFFS.md).

## Four parallel lanes
| Developer | Owned working files | Integration handoff |
|---|---|---|
| Naweed / nm-04 | `apps/chat-api/`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `docs/ARCHITECTURE.md` | Stable HTTP/WS messages and main UI imports |
| Jin / JCYuhei | `apps/ai-service/`, `docs/DEMO.md` | Backward-compatible AI responses, optional structured proposals |
| Vera / vmalkova | `apps/web/src/features/` and component-scoped CSS | Typed React components imported by Naweed; calls existing chat API |
| Dev / Prittstick22 | `tests/`, `scripts/`, `fixtures/`, `.github/workflows/`, API contract and timeline | End-to-end verification, contract approvals, merge decisions |

## Branching
Each issue gets a short-lived branch (`feat/10-semantic-search`) and PR, never direct main edits after bootstrap. Include issue link, changed files, tests, sample payload and screenshots. One reviewer (Dev prioritises P0). Rebase on latest main before resolving conflicts. Avoid force pushing shared branches. Only Dev approves post-freeze critical merges.

## Shared contracts
Chat API port 8000, AI API port 8001, UI 5173. **Implement routes and payloads in [CONTRACT_V1](CONTRACT_V1.md)** (some are targets, not scaffold functionality). Existing routes `POST /messages`, `GET /messages`, `WS /ws`, `GET /digest`, `GET /search`, `GET /suggest`, `GET/POST /polls`, `POST /polls/{id}/votes`, `GET /calendar.ics`. Never invent a competing `/insights` endpoint without contract agreement.

## Conflict protocol
1. Contracts agreed 09:45–10:00.
2. One owner per shared file; component developers avoid `main.tsx` and global styles.
3. Backend-specific changes proposed with exact JSON and owner handoff.
4. Integrate incrementally, review PR and run tests, not all at the end.
5. If a feature does not integrate by 14:15, remove/disable it for the final demo.

## Scheduled gates
See [TIMELINE.md](TIMELINE.md): messaging by 11:00; AI by 12:30; action by 13:30; feature freeze 14:15; submission by 16:00 BST.
