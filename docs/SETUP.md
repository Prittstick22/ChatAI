# Developer environment setup

## Prerequisites
- Git and GitHub access
- Docker Desktop with Docker Compose (recommended; start Docker Desktop before running commands)
- [uv](https://docs.astral.sh/uv/) and Node.js 20+ with npm for non-Docker work. uv installs the right Python (3.11, from each service's `.python-version`) by itself.
  - macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `brew install uv`)
  - Windows: `winget install --id=astral-sh.uv -e`
- Editor: VS Code, with Python, Pylance, ESLint and Prettier extensions. Open `ChatAI.code-workspace` (File → Open Workspace from File), not the repo folder, so each Python service gets its own interpreter. Run `uv sync` once in `apps/chat-api` and `apps/ai-service` to create their `.venv`; if VS Code doesn't pick it, run **Python: Select Interpreter**, choose the service folder, then its `.venv`.
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
uv run uvicorn main:app --reload --port 8001
```
**Chat service** in separate terminal:
```bash
cd apps/chat-api
uv run uvicorn main:app --reload --port 8000
```
`uv run` creates `.venv` and installs the locked dependencies on first use, so there is no venv to activate.
**React** in a third terminal:
```bash
cd apps/web
npm install
npm run dev
```
For local execution without Compose, set `AI_URL=http://localhost:8001` for chat and supply `OPENAI_API_KEY` to the AI service shell if needed.

## Python dependencies (uv)
uv is the package manager for both Python services; each has its own `pyproject.toml` and `uv.lock`. Do not use `pip install`.
- Add a package: `cd apps/<service>` then `uv add <package>`. Commit both `pyproject.toml` and `uv.lock`.
- Remove one: `uv remove <package>`.
- After pulling someone else's dependency change, `uv run` picks it up automatically; rebuild Docker with `docker compose up --build`.

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
- Docker build fails at `uv sync --locked`: `pyproject.toml` changed without updating the lock. Run `uv lock` in that service and commit `uv.lock`.
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

## Docker verification and restart

After running `docker compose up --build`, open a second terminal in the repository root and check the containers:

```powershell
docker compose ps
```

All three services (`web`, `chat`, and `ai`) should show a running status.

Verify these endpoints:

| Service | URL | Expected result |
|---|---|---|
| Frontend | http://localhost:5173 | Web application loads |
| Chat API | http://localhost:8000/health | `{"status":"ok"}` |
| AI service | http://localhost:8001/health | JSON containing `"status":"ok"` |

To stop the application:

```powershell
docker compose down
```

To rebuild and restart it in the background:

```powershell
docker compose up --build -d
```

Then run `docker compose ps` and repeat the health checks.

**AI fallback behaviour:** If the OpenAI API key has insufficient credits, `/digest` may return a fallback summary even though the endpoint responds with HTTP 200. A successful HTTP response does not necessarily mean AI generation succeeded.

For a fresh installation, follow the platform-specific clone and `.env` setup instructions above before running Compose.