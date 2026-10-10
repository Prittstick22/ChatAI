"""Dev tools behind the web app's dev panel: load the premade chats in fixtures/, and
start a chat (or everything) again from nothing. For rehearsing and recording the
demo; set DEV_TOOLS=0 to turn them off.

A premade chat is a fixture with room_name, created_by, members and messages (the
format scripts/seed_demo.py reads). Optional fields:

    "at": "-1d 19:41"     on a message: when it was sent (London time, days from today);
                          without it, messages are spread a few minutes apart up to now
    "presenter": "Sam"    who presents the demo, and has read only the first
    "presenter_read": 4   presenter_read messages, so they come back to the rest
    "other_rooms": [...]  {"room", "messages"} to fill other empty rooms, so the
                          sidebar looks lived in
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import store

ENABLED = os.getenv("DEV_TOOLS", "1") != "0"
# The repo's fixtures/ folder; docker-compose mounts it at /fixtures.
FIXTURES_DIR = Path(
    os.getenv("FIXTURES_DIR")
    or Path(__file__).resolve().parent.parent.parent / "fixtures"
)
LONDON = ZoneInfo("Europe/London")
SPACING = timedelta(minutes=3)
REQUIRED = {"room_name", "created_by", "members", "messages"}
STORY_ID = re.compile(r"[\w-]{1,64}")


def backup_dir() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(store.db_path())), "backups")


def _read(path: Path) -> dict | None:
    try:
        story = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(story, dict) or not REQUIRED <= story.keys():
        return None
    return story if story["messages"] else None


def stories() -> list[dict]:
    """The premade chats, for the panel's list."""
    found = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        story = _read(path)
        if story:
            found.append(
                {
                    "id": path.stem,
                    "name": story["room_name"],
                    "people": [story["created_by"], *story["members"]],
                    "messages": len(story["messages"]),
                    "presenter": story.get("presenter"),
                }
            )
    return found


def _story(story_id: str) -> dict:
    story = (
        _read(FIXTURES_DIR / f"{story_id}.json")
        if STORY_ID.fullmatch(story_id)
        else None
    )
    if story is None:
        raise store.NotFound(f"No premade chat called {story_id!r}")
    return story


def _when(at: str, now: datetime) -> datetime:
    """ "-1d 19:41": yesterday at 19:41, London time."""
    days, clock = at.split()
    hour, minute = map(int, clock.split(":"))
    local = now.astimezone(LONDON) + timedelta(days=int(days.removesuffix("d")))
    return local.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _timed(messages: list[dict], now: datetime) -> list[dict]:
    """The messages with a created_at each, never later than now."""
    timed = []
    for i, m in enumerate(messages):
        at = _when(m["at"], now) if m.get("at") else now - SPACING * (len(messages) - i)
        timed.append(
            {
                "user": m["user"],
                "text": m["text"],
                "created_at": min(at, now).astimezone(timezone.utc).isoformat(),
            }
        )
    return timed


def reset(story_id: str | None) -> tuple[str, dict | None]:
    """Back up the database, delete everything, then load the premade chat if given.
    Returns the backup's path and what was loaded."""
    if story_id:
        _story(story_id)  # before anything is deleted
    backup = store.backup(backup_dir())
    store.wipe()
    return backup, load(story_id) if story_id else None


def load(story_id: str) -> dict:
    """Create a premade chat, replacing any room with the same name."""
    story = _story(story_id)
    rooms = store.list_rooms()
    for room in rooms:
        if room["name"] == story["room_name"]:
            store.delete_room(room["id"])
    room = store.create_room(story["room_name"], story["created_by"], story["members"])
    now = datetime.now(timezone.utc)
    ids = store.insert_history(room["id"], _timed(story["messages"], now))

    # Everyone is up to date, except the presenter, who has been away since message
    # presenter_read.
    presenter = story.get("presenter")
    read = min(int(story.get("presenter_read") or len(ids)), len(ids))
    for person in [story["created_by"], *story["members"]]:
        position = ids[read - 1] if person == presenter else ids[-1]
        store.mark_read(room["id"], person, position)

    existing = {r["id"] for r in rooms}
    for other in story.get("other_rooms", []):
        if other["room"] in existing and not store.list_messages(other["room"], 1):
            store.insert_history(other["room"], _timed(other["messages"], now))
    return {"room": room["id"], "name": room["name"], "messages": len(ids)}
