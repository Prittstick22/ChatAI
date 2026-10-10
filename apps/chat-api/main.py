"""ChatAI chat API: the public REST + WebSocket gateway on :8000.

Persistence lives in store.py (SQLite), live fan-out in realtime.py. The AI service is
called over HTTP with a timeout and a fallback for every route, so chat keeps working
when AI is slow or down.
"""

import asyncio
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, StringConstraints

import devtools
import nudges
import store
import summaries
from realtime import Client, Hub

AI_URL = os.getenv("AI_URL", "http://localhost:8001")
AI_TIMEOUT = 15
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

log = logging.getLogger("chat-api")
hub = Hub()
background: set[asyncio.Task] = set()

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]
Text = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
RoomId = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
RoomName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]
Emoji = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16)
]
PollText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.init()
    async with httpx.AsyncClient(timeout=AI_TIMEOUT) as client:
        app.state.ai = client
        # Looked up on each call so tests can stub ai_call.
        app.state.nudger = nudges.Nudger(hub, lambda *args: ai_call(*args))
        app.state.summariser = summaries.Summariser(hub, lambda *args: ai_call(*args))
        yield
    for task in list(background):
        task.cancel()


app = FastAPI(title="ChatAI Chat API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for error, status in (
    (store.NotFound, 404),
    (store.Forbidden, 403),
    (store.Conflict, 409),
    (store.Invalid, 400),
):

    async def handler(request: Request, exc: Exception, status: int = status):
        return JSONResponse({"detail": str(exc)}, status_code=status)

    app.add_exception_handler(error, handler)


def clean_user(user: str | None) -> str | None:
    return (user or "").strip()[:40] or None


def run_in_background(coro) -> None:
    task = asyncio.create_task(coro)
    background.add(task)
    task.add_done_callback(_background_done)


def _background_done(task: asyncio.Task) -> None:
    background.discard(task)
    if not task.cancelled() and task.exception():
        log.warning("Background task failed: %r", task.exception())


class NewMessage(BaseModel):
    user: Name
    text: Text
    room: RoomId = store.DEFAULT_ROOM
    reply_to: int | None = None
    # Echoed back on the response and the WebSocket event so the sender can match
    # its optimistic copy. Not stored.
    client_id: str | None = Field(default=None, max_length=64)


class EditMessage(BaseModel):
    user: Name
    text: Text


class ReactionIn(BaseModel):
    user: Name
    emoji: Emoji


class NewRoom(BaseModel):
    name: RoomName
    created_by: Name | None = None
    members: list[Name] | None = Field(default=None, min_length=1, max_length=100)


class ReadIn(BaseModel):
    user: Name
    message_id: int = Field(ge=0)


class PollIn(BaseModel):
    question: PollText
    options: list[PollText] = Field(min_length=2, max_length=10)
    room: RoomId = store.DEFAULT_ROOM
    created_by: Name | None = None
    # The AI proposal (nudge) it was made from: a room gets one poll per proposal.
    proposal_id: str | None = Field(default=None, max_length=120)


class VoteIn(BaseModel):
    user: Name
    option_index: int


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------- rooms


@app.get("/rooms")
def rooms(user: str | None = None):
    return store.list_rooms(clean_user(user))


@app.post("/rooms", status_code=201)
async def create_room(body: NewRoom):
    if body.members is not None and not any(
        member != body.created_by for member in body.members
    ):
        raise HTTPException(status_code=422, detail="Select at least one other person")
    room = store.create_room(body.name, body.created_by, body.members)
    await hub.broadcast({"type": "room", "room": {**room, "unread": 0}})
    return room


@app.delete("/rooms/{room}")
async def leave_room(
    room: str, user: Annotated[str, Query(min_length=1, max_length=40)]
):
    user = user.strip()
    store.leave_room(room, user)
    await hub.broadcast({"type": "room_member_left", "room": room, "user": user})
    return {"left": True, "room": room, "user": user}


@app.get("/rooms/{room}/summary")
def room_summary(room: str):
    """The latest automatic summary (see summaries.py), or null before the first."""
    return {"summary": app.state.summariser.latest.get(room)}


@app.post("/rooms/{room}/read")
async def mark_read(room: str, body: ReadIn):
    position, moved = store.mark_read(room, body.user, body.message_id)
    if moved:
        await hub.broadcast(
            {"type": "read", "room": room, "user": body.user, "message_id": position},
            room=room,
        )
    return {"room": room, "user": body.user, "message_id": position}


# ---------------------------------------------------------------- messages


@app.get("/messages")
def messages(
    room: str = store.DEFAULT_ROOM,
    limit: int = Query(store.PAGE_LIMIT, ge=1, le=store.PAGE_LIMIT),
    before_id: int | None = None,
    after_id: int | None = None,
):
    return store.list_messages(room, limit, before_id, after_id)


@app.post("/messages", status_code=201)
async def post_message(m: NewMessage):
    message = store.create_message(m.room, m.user, m.text, m.reply_to)
    if m.client_id:
        message["client_id"] = m.client_id
    await hub.broadcast({"type": "message", "message": message}, room=m.room)
    run_in_background(app.state.nudger.after_message(message))
    run_in_background(app.state.summariser.after_message(message))
    return message


@app.patch("/messages/{message_id}")
async def edit_message(message_id: int, body: EditMessage):
    message = store.edit_message(message_id, body.user, body.text)
    await hub.broadcast(
        {"type": "message_updated", "message": message}, room=message["room"]
    )
    return message


@app.delete("/messages/{message_id}")
async def delete_message(
    message_id: int, user: Annotated[str, Query(min_length=1, max_length=40)]
):
    message = store.delete_message(message_id, user.strip())
    await hub.broadcast(
        {"type": "message_updated", "message": message}, room=message["room"]
    )
    return message


@app.post("/messages/{message_id}/reactions")
async def react(message_id: int, body: ReactionIn):
    message = store.toggle_reaction(message_id, body.user, body.emoji)
    await hub.broadcast(
        {"type": "message_updated", "message": message}, room=message["room"]
    )
    return message


@app.websocket("/ws")
async def ws_events(ws: WebSocket, user: str | None = None, room: str | None = None):
    """Server events: message, message_updated, typing, presence, read, room, poll,
    pong, nudge (AI proposals, nudges.py), summary (summaries.py) and reset (the dev
    tools replaced messages: reload). Client events:
    typing, ping."""
    await ws.accept()
    client = Client(ws, clean_user(user), room or None)
    await hub.join(client)
    try:
        while True:
            try:
                data = json.loads(await ws.receive_text())
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            if data.get("type") == "ping":
                await hub.send(client, {"type": "pong"})
            elif (
                data.get("type") == "typing"
                and client.user
                and isinstance(data.get("room"), str)
            ):
                target = data["room"][:64]
                event = {
                    "type": "typing",
                    "room": target,
                    "user": client.user,
                    "active": data.get("active") is not False,
                }
                await hub.broadcast(event, room=target, exclude=client)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.info("WebSocket closed: %r", exc)
    finally:
        hub.leave(client)
        if client.user:
            run_in_background(hub.broadcast_presence())


# ---------------------------------------------------------------- AI gateway


async def ai_call(path: str, payload: dict, fallback: dict):
    try:
        r = await app.state.ai.post(AI_URL + path, json=payload)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.warning("AI %s unavailable: %r", path, exc)
        return fallback


@app.get("/digest")
async def digest(room: str = store.DEFAULT_ROOM):
    """Summarise now. The result becomes the room's latest summary and is pushed to
    everyone in it, like the automatic ones (summaries.py)."""
    if not store.recent_for_ai(room):
        return {"summary": "No messages to summarise yet."}
    summary = await app.state.summariser.summarise_now(room)
    if summary is None:
        return {"summary": "AI temporarily unavailable; chat remains operational."}
    return {**summary, "summary": summary["text"]}


@app.get("/search")
async def search(query: str, room: str = store.DEFAULT_ROOM):
    """Hybrid search. SQLite full-text search covers the room's whole history and
    catches exact words and names; the AI service ranks recent messages by meaning.
    The two rankings are merged with reciprocal rank fusion, so a message both find
    comes first. Each result says which found it (`match`) and, for keyword hits,
    which words matched (`highlight`)."""
    query = query.strip()[:200]
    if not query:
        return {"results": [], "mode": "keyword"}
    keyword = store.search_messages(room, query)
    ai = await ai_call(
        "/search",
        {"messages": store.recent_for_ai(room), "query": query},
        {"results": [], "mode": "keyword"},
    )
    # Only a semantic ranking adds anything; the AI's own keyword fallback is a plain
    # substring match, which full-text search already beats.
    mode = "semantic" if ai.get("mode") == "semantic" else "keyword"
    semantic = ai.get("results", []) if mode == "semantic" else []
    rankings = {
        "keyword": [m["id"] for m in keyword],
        "semantic": [m.get("id") for m in semantic if isinstance(m, dict)],
    }
    scores: dict[int, float] = {}
    found_by: dict[int, list[str]] = {}
    for source, ids in rankings.items():
        for rank, message_id in enumerate(ids):
            if not isinstance(message_id, int):
                continue
            scores[message_id] = scores.get(message_id, 0) + 1 / (60 + rank)
            found_by.setdefault(message_id, []).append(source)
    best = sorted(scores, key=scores.__getitem__, reverse=True)[: store.SEARCH_LIMIT]
    highlights = {m["id"]: m["highlight"] for m in keyword}
    results = [
        {**m, "match": found_by[m["id"]], "highlight": highlights.get(m["id"])}
        for m in store.get_messages(room, best)
    ]
    return {"results": results, "mode": mode}


@app.get("/suggest")
async def suggest(room: str = store.DEFAULT_ROOM):
    history = store.recent_for_ai(room)
    return await ai_call(
        "/suggest", {"messages": history}, {"suggestion": "No suggestion"}
    )


@app.get("/replies")
async def replies(room: str, user: str):
    """Up to three replies `user` could send next in `room`, written the way they write.
    Empty when the newest message is their own, or when AI is unavailable."""
    user = clean_user(user) or ""
    history = store.recent_for_ai(room, 30)
    if not user or not history or history[-1]["user"] == user:
        return {"replies": []}
    answer = await ai_call(
        "/replies",
        {"messages": history, "user": user, "style": store.style_samples(user)},
        {"replies": []},
    )
    texts = answer.get("replies") if isinstance(answer, dict) else None
    if not isinstance(texts, list):
        return {"replies": []}
    return {"replies": [t for t in texts if isinstance(t, str) and t.strip()][:3]}


# ---------------------------------------------------------------- polls and calendar


@app.get("/polls")
def polls(room: str | None = None):
    return store.list_polls(room)


@app.post("/polls")
async def create_poll(p: PollIn):
    """Creates the poll and posts it into the conversation as a message (Message.poll).
    Asking again for the same proposal_id returns the first poll and posts nothing."""
    poll, message = store.create_poll(
        p.question, p.options, p.room, p.created_by, p.proposal_id
    )
    if message:
        await hub.broadcast({"type": "message", "message": message}, room=p.room)
        await hub.broadcast({"type": "poll", "poll": poll}, room=poll["room"])
        run_in_background(app.state.summariser.after_message(message))
    return poll


@app.post("/polls/{poll_id}/votes")
async def vote(poll_id: int, data: VoteIn):
    poll = store.vote(poll_id, data.user, data.option_index)
    await hub.broadcast({"type": "poll", "poll": poll}, room=poll["room"])
    return {"ok": True, "poll": poll}


@app.get("/calendar.ics")
def calendar(title: str = "Group event", date: str = "20261010T120000Z"):
    if not re.fullmatch(r"\d{8}T\d{6}Z", date):
        raise HTTPException(400, "Date must be YYYYMMDDTHHMMSSZ in UTC")
    safe = (
        title.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )
    body = f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ChatAI//EN\r\nBEGIN:VEVENT\r\nUID:demo-{date}@chatai\r\nDTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}\r\nDTSTART:{date}\r\nSUMMARY:{safe}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    return Response(
        body,
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=event.ics"},
    )


# ---------------------------------------------------------------- dev tools


class DevReset(BaseModel):
    story: str | None = Field(default=None, max_length=64)


def _dev_tools_on() -> None:
    if not devtools.ENABLED:
        raise HTTPException(404, "Dev tools are off (DEV_TOOLS=0)")


def _stop_background_work() -> None:
    """Pending nudges and summaries are about messages that are about to go."""
    for task in list(background):
        task.cancel()


def _room_name(room: str) -> str:
    return next((r["name"] for r in store.list_rooms() if r["id"] == room), room)


async def _replaced(
    note: str, room: str | None, everything: bool = False, show: bool = False
) -> None:
    """After a room's messages were replaced (or every room's): forget what the AI had
    worked out, prepare the room's summary so its catch-up is ready, and tell every
    open tab to reload (opening the room when `show`)."""
    for helper in (app.state.nudger, app.state.summariser):
        helper.forget(None if everything else room)
    if room and store.recent_for_ai(room):
        await app.state.summariser.summarise_now(room)
    event = {"type": "reset", "note": note}
    await hub.broadcast({**event, "room": room} if show and room else event)


@app.get("/dev/stories")
def dev_stories():
    """The premade chats in fixtures/."""
    _dev_tools_on()
    return devtools.stories()


@app.post("/dev/stories/{story_id}")
async def dev_load(story_id: str):
    """Load a premade chat, replacing the room with its name."""
    _dev_tools_on()
    _stop_background_work()
    loaded = devtools.load(story_id)
    await _replaced(f"Loaded {loaded['name']}", loaded["room"], show=True)
    return loaded


@app.post("/dev/reset")
async def dev_reset(body: DevReset):
    """Back up the database and delete everything, then load `story` if given."""
    _dev_tools_on()
    _stop_background_work()
    backup, loaded = devtools.reset(body.story)
    note = f"Started again with {loaded['name']}" if loaded else "Deleted every chat"
    await _replaced(note, loaded and loaded["room"], everything=True, show=True)
    return {"backup": backup, "loaded": loaded}


@app.post("/dev/rooms/{room}/clear")
async def dev_clear(room: str):
    """Delete a room's messages; the room and its members stay."""
    _dev_tools_on()
    _stop_background_work()
    name = _room_name(room)
    store.clear_room(room)
    await _replaced(f"Cleared {name}", room)
    return {"room": room}


@app.delete("/dev/rooms/{room}")
async def dev_delete_room(room: str):
    _dev_tools_on()
    _stop_background_work()
    name = _room_name(room)
    store.erase_room(room)
    await _replaced(f"Deleted {name}", room)
    return {"room": room}
