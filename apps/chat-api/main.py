import os
import sqlite3
from datetime import datetime, timezone
from contextlib import closing
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

DB = os.getenv("DB_PATH", "chat.db")
AI_URL = os.getenv("AI_URL", "http://localhost:8001")
app = FastAPI(title="ChatAI Chat API")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
connections: set[WebSocket] = set()

def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

@app.on_event("startup")
def init():
    with closing(conn()) as db:
        db.execute("CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, user TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS polls(id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, options TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS votes(poll_id INTEGER NOT NULL, user TEXT NOT NULL, option_index INTEGER NOT NULL, PRIMARY KEY(poll_id,user))")
        db.commit()

class NewMessage(BaseModel):
    user: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=2000)
    room: str = "demo"

class PollIn(BaseModel):
    question: str
    options: list[str]

class VoteIn(BaseModel):
    user: str
    option_index: int

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/messages")
def messages(room: str = "demo"):
    with closing(conn()) as db:
        return [dict(r) for r in db.execute("SELECT * FROM messages WHERE room=? ORDER BY id DESC LIMIT 100", (room,)).fetchall()][::-1]

@app.post("/messages", status_code=201)
async def post_message(m: NewMessage):
    created = datetime.now(timezone.utc).isoformat()
    with closing(conn()) as db:
        cur = db.execute("INSERT INTO messages(room,user,text,created_at) VALUES (?,?,?,?)", (m.room,m.user,m.text,created))
        db.commit()
        output = {"id":cur.lastrowid, "room":m.room, "user":m.user, "text":m.text, "created_at":created}
    for ws in list(connections):
        try: await ws.send_json({"type":"message", "message":output})
        except Exception: connections.discard(ws)
    return output

@app.websocket("/ws")
async def ws_messages(ws: WebSocket):
    await ws.accept()
    connections.add(ws)
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect:
        connections.discard(ws)
    except Exception:
        connections.discard(ws)

async def ai_call(path: str, payload: dict, fallback: dict):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(AI_URL + path, json=payload)
            r.raise_for_status()
            return r.json()
    except Exception:
        return fallback

@app.get("/digest")
async def digest():
    return await ai_call("/digest", {"messages":messages()}, {"summary":"AI temporarily unavailable; chat remains operational."})

@app.get("/search")
async def search(query: str):
    return await ai_call("/search", {"messages":messages(), "query":query}, {"results":[m for m in messages() if query.lower() in m["text"].lower()], "mode":"keyword"})

@app.get("/suggest")
async def suggest():
    return await ai_call("/suggest", {"messages":messages()}, {"suggestion":"No suggestion"})

@app.get("/polls")
def polls():
    import json
    with closing(conn()) as db:
        rows=db.execute("SELECT * FROM polls ORDER BY id DESC").fetchall()
        return [{"id":r["id"],"question":r["question"],"options":json.loads(r["options"])} for r in rows]

@app.post("/polls")
def create_poll(p: PollIn):
    import json
    with closing(conn()) as db:
        cur=db.execute("INSERT INTO polls(question,options) VALUES(?,?)", (p.question,json.dumps(p.options)))
        db.commit()
        return {"id":cur.lastrowid, **p.model_dump()}

@app.post("/polls/{poll_id}/votes")
def vote(poll_id: int, data: VoteIn):
    from fastapi import HTTPException
    with closing(conn()) as db:
        poll = db.execute("SELECT options FROM polls WHERE id=?", (poll_id,)).fetchone()
        if not poll: raise HTTPException(404,"Poll not found")
        import json
        if not (0 <= data.option_index < len(json.loads(poll["options"]))): raise HTTPException(400,"Invalid option")
        db.execute("INSERT OR REPLACE INTO votes(poll_id,user,option_index) VALUES (?,?,?)", (poll_id,data.user,data.option_index))
        db.commit()
    return {"ok":True}

@app.get("/calendar.ics")
def calendar(title: str = "Group event", date: str = "20261010T120000Z"):
    from fastapi.responses import Response
    import re
    if not re.fullmatch(r"\d{8}T\d{6}Z",date):
        from fastapi import HTTPException
        raise HTTPException(400,"Date must be YYYYMMDDTHHMMSSZ in UTC")
    safe = title.replace("\\","\\\\").replace(";","\\;").replace(",","\\,").replace("\n","\\n")
    body=f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ChatAI//EN\r\nBEGIN:VEVENT\r\nUID:demo-{date}@chatai\r\nDTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}\r\nDTSTART:{date}\r\nSUMMARY:{safe}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    return Response(body, media_type="text/calendar", headers={"Content-Disposition":"attachment; filename=event.ics"})
