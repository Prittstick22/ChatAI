# Developer environment setup

## Prerequisites
- Git and GitHub access
- Docker Desktop with Docker Compose (recommended; start Docker Desktop before running commands)
- Python 3.11+ and Node.js 20+ with npm for non-Docker work
- Editor: VS Code, with Python, Pylance, ESLint and Prettier extensions
- Optional: OpenAI API key, stored **only** in a local `.env`

## Windows 10/11 — PowerShell
```powershell
git clone https://github.com/Prittstick22/ChatAI.git
cd ChatAI
Copy-Item .env.example .env
notepad .env
docker compose up --build
```
Open <http://localhost:5173>. Open API docs at <http://localhost:8000/docs> and <http://localhost:8001/docs>. Docker Desktop should use WSL2.

## macOS / Linux — Terminal
```bash
git clone https://github.com/Prittstick22/ChatAI.git
cd ChatAI
cp .env.example .env
nano .env
docker compose up --build
```

## Running without Docker (three terminals)
**AI service**:
```bash
cd apps/ai-service
python -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```
**Chat service** in separate terminal:
```bash
cd apps/chat-api
python -m venv .venv
# Activate as above
python -m pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
**React** in a third terminal:
```bash
cd apps/web
npm install
npm run dev
```
For local execution without Compose, set `AI_URL=http://localhost:8001` for chat and supply `OPENAI_API_KEY` to the AI service shell if needed.

If Windows blocks PowerShell environment activation, use `.venv\Scripts\python.exe -m pip ...` and `.venv\Scripts\python.exe -m uvicorn ...` instead of changing system execution policies.

## Smoke checks
1. Open both FastAPI `/docs` interfaces.
2. Open two browser sessions (incognito is fine), switch identities and send a chat message.
3. Confirm both browsers receive the message without refresh.
4. Try summary and search; without an API key, expect fallback/limited functionality.
5. Verify poll creation and calendar export if merged.

## Common fixes
- Port in use: stop the conflicting app, or change exposed Compose port and corresponding frontend API endpoint.
- CORS: add the exact frontend origin to `CORS_ORIGINS` and restart chat.
- No key: set `OPENAI_API_KEY` in `.env`; restart `docker compose up --build`.
- Dependency issue: `docker compose build --no-cache`.
- View logs: `docker compose logs -f ai chat web`.
- Reset demo SQLite data: `docker compose down -v` (destructive).
- Never commit your `.env` or share keys in chat/issues.

## Four-machine collaboration
Each developer clones the repo and works on their *own branch*. Running Docker on each laptop is independent. For simultaneous shared chat, use a single network-reachable demo host or shared deployment; `localhost` is different on each device. Do not expose this unauthenticated MVP on the public internet.

## Before every PR
```bash
git fetch origin
git switch main
git pull --ff-only
git switch -c feat/<short-topic>
# make changes, test locally
git add .
git commit -m "feat: <topic>"
git push -u origin feat/<short-topic>
```
Open a PR into `main`, request review, merge small changes, then pull `main` again.
