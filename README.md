# ChatAI — the group chat that organises itself

**QMUL Invisible AI Hackathon • 10 October 2026**

A real-time group messenger designed to automatically turn noisy conversations into summaries, semantic search results, polls and calendar suggestions.

## Quick start
1. Install Git, Docker Desktop, Node.js 20+ and Python 3.11+.
2. Clone: `git clone https://github.com/Prittstick22/ChatAI.git`
3. Go into `ChatAI`; copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
4. Set `OPENAI_API_KEY` in `.env` (optional for fallback).
5. Run `docker compose up --build`.
6. Open http://localhost:5173. APIs: http://localhost:8000/docs and http://localhost:8001/docs.

Read **[environment setup](docs/SETUP.md)**, **[architecture](docs/ARCHITECTURE.md)**, **[collaboration](docs/COLLABORATION.md)** and **[demo](docs/DEMO.md)** before coding.

## Developer ownership
- A — `apps/chat-api/`: messages, SQLite, WS, polls, calendar exports
- B — `apps/ai-service/`: digests, embedding search, topic/event extraction
- C — `apps/web/`: chat UI and AI feature interface
- D — `docs/`, `scripts/`: integration, testing, demo, submission

## Feature priorities
**P0** two-browser chat, digest, natural-language search, event suggestion and ICS export.
**P1** poll suggestions and voting.
**P2** smart replies and authentication.

## Scope and constraints
This is an **MVP scaffold**, not a production-safe chat platform. Demo users have no authentication; do not use personal conversations. In-memory WebSocket broadcasts imply one chat server replica. AI unavailable? Chat should stay usable.

**Hackathon note:** follow the organiser's rules on pre-event work and disclose any substantial premade scaffold. Build/validate the demo during the event. Submission closes 16:00 BST.
