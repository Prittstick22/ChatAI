# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Reset the local Docker stack to the demo story, and play the live scenes for the video.

    uv run scripts/demo.py reset   # back up and wipe the chat DB, seed fixtures/demo_story.json
    uv run scripts/demo.py poll    # the group argues about food: the AI suggests a poll
    uv run scripts/demo.py plan    # a call is planned, then moved: the event card updates

Open http://localhost:5173/?as=Sam (the presenter) before playing a scene. The other
people type and post through the public Chat API, with typing indicators, and wait for
the AI's suggestions to arrive over the WebSocket, so each scene plays the same way.
reset needs the stack from `docker compose up`; the backup lands in the chatdata
volume under /data/backups.
"""

import argparse
import asyncio
import json
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import websockets

import seed_demo

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "demo_story.json"
API = "http://localhost:8000"
LONDON = ZoneInfo("Europe/London")
SUGGESTION_TIMEOUT = 30


class DemoError(Exception):
    pass


def api(path: str, payload: dict | None = None):
    try:
        return seed_demo.request(API, path, payload)
    except seed_demo.SeedError as exc:
        raise DemoError(str(exc)) from exc


# ---------------------------------------------------------------- reset


def compose(*args: str, stdin: str | None = None) -> str:
    result = subprocess.run(
        ["docker", "compose", *args],
        cwd=ROOT,
        input=stdin,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise DemoError(f"docker compose {' '.join(args)} failed:\n{result.stderr}")
    return result.stdout


def wait_for_api(seconds: float = 30) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            api("/health")
            return
        except (DemoError, OSError):  # refused or reset while it starts
            if time.monotonic() > deadline:
                raise
            time.sleep(0.5)


def when(at: str, now: datetime) -> str:
    """ "-1d 19:41" (yesterday at 19:41, London time) as a UTC ISO timestamp."""
    days, clock = at.split()
    hour, minute = map(int, clock.split(":"))
    local = now.astimezone(LONDON) + timedelta(days=int(days.removesuffix("d")))
    local = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return local.astimezone(ZoneInfo("UTC")).isoformat()


def set_times(times: dict[int, str]) -> None:
    """Spread the seeded messages over the times in the fixture (the API stamps them
    all with "now")."""
    script = f"""
import store
db = store.connect()
with db:
    db.executemany("UPDATE messages SET created_at = ? WHERE id = ?", {[(at, mid) for mid, at in times.items()]!r})
"""
    compose("exec", "-T", "chat", "python", "-", stdin=script)


def reset() -> None:
    story = json.loads(FIXTURE.read_text(encoding="utf-8"))
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    print("Backing up and wiping the chat database…")
    compose("stop", "chat")
    compose(
        "run", "--rm", "--no-deps", "-T", "chat", "sh", "-c",
        f"mkdir -p /data/backups && for f in /data/chat.db*; do [ -e \"$f\" ] && cp \"$f\" \"/data/backups/$(basename \"$f\").{stamp}\"; done; rm -f /data/chat.db /data/chat.db-wal /data/chat.db-shm",
    )  # fmt: skip
    compose("start", "chat")
    wait_for_api()

    try:
        room_id, added, _ = seed_demo.run(API, FIXTURE)
    except seed_demo.SeedError as exc:
        raise DemoError(str(exc)) from exc
    now = datetime.now(LONDON)
    history = api(f"/messages?{urllib.parse.urlencode({'room': room_id})}")
    times = {m["id"]: when(f["at"], now) for m, f in zip(history, story["messages"])}
    for other in story.get("other_rooms", []):
        for message in other["messages"]:
            posted = api("/messages", {**message, "room": other["room"]})
            times[posted["id"]] = when(message["at"], now)
    set_times(times)

    # The presenter read the start of the story and has been away since; everyone
    # else is up to date.
    read_upto = history[story["presenter_read"] - 1]["id"]
    for person in [story["created_by"], *story["members"]]:
        position = read_upto if person == story["presenter"] else history[-1]["id"]
        api(f"/rooms/{room_id}/read", {"user": person, "message_id": position})

    # Restart so suggestions only start from the live scenes, then make the catch-up
    # ready so the presenter's card appears straight away.
    compose("restart", "chat")
    wait_for_api()
    print("Preparing the catch-up summary…")
    summary = api(f"/digest?{urllib.parse.urlencode({'room': room_id})}")
    print(f"Seeded {story['room_name']!r} ({added} messages).")
    print(f"Catch-up: {summary.get('headline') or summary.get('summary')}")
    print(f"Backup: chatdata volume, /data/backups/chat.db.{stamp}")
    print(f"\nOpen http://localhost:5173/?as={story['presenter']}#/{room_id}")


# ---------------------------------------------------------------- live scenes


class Person:
    """Someone in the scene: online over the WebSocket, typing before they post."""

    def __init__(self, name: str, room: str):
        self.name, self.room = name, room
        self.ws = None

    async def __aenter__(self):
        query = urllib.parse.urlencode({"user": self.name, "room": self.room})
        self.ws = await websockets.connect(f"ws://localhost:8000/ws?{query}")
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()

    async def say(self, text: str, pause: float = 1.2) -> dict:
        await self.ws.send(json.dumps({"type": "typing", "room": self.room}))
        await asyncio.sleep(min(2.6, 0.7 + len(text) * 0.035))
        message = await asyncio.to_thread(
            api, "/messages", {"user": self.name, "text": text, "room": self.room}
        )
        print(f"  {self.name}: {text}")
        await asyncio.sleep(pause)
        return message

    async def wait_for(self, check, seconds: float) -> dict | None:
        """The first event on this person's connection that passes `check`."""
        try:
            async with asyncio.timeout(seconds):
                async for raw in self.ws:
                    event = json.loads(raw)
                    if check(event):
                        return event
        except TimeoutError:
            return None


def room_id() -> str:
    story = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rooms = api("/rooms")
    for room in rooms:
        if room["name"] == story["room_name"]:
            return room["id"]
    raise DemoError("The demo room doesn't exist yet: run `demo.py reset` first.")


async def poll_scene() -> None:
    room = room_id()
    async with (
        Person("Jordan", room) as jordan,
        Person("Taylor", room) as taylor,
        Person("Alex", room) as alex,
    ):
        await asyncio.sleep(1)
        await jordan.say("For food after, pizza or tacos?")
        await taylor.say("tacos! or the ramen place by the station")
        await alex.say("I'm easy, all three sound good")
        # The card can arrive with two options and grow a third once ramen comes up.
        nudge = await alex.wait_for(
            lambda e: (
                e["type"] == "nudge"
                and e["nudge"]["type"] == "poll"
                and any("ramen" in o.lower() for o in e["nudge"].get("options") or [])
            ),
            SUGGESTION_TIMEOUT,
        )
        if not nudge:
            print("  (no poll suggestion with all three options yet)")
        print("  Tap Create poll as Sam.")
        made = await alex.wait_for(
            lambda e: e["type"] == "message" and (e["message"].get("poll") or {}),
            120,
        )
        if not made:
            raise DemoError("Nobody created the poll within 2 minutes.")
        poll = made["message"]["poll"]

        def option(word: str, fallback: int) -> int:
            for i, label in enumerate(poll["options"]):
                if word in label.lower():
                    return i
            return min(fallback, len(poll["options"]) - 1)

        for person, word, fallback, pause in (
            ("Taylor", "ramen", 2, 1.4),
            ("Jordan", "taco", 1, 1.8),
            ("Alex", "ramen", 2, 1.6),
        ):
            await asyncio.sleep(pause)
            await asyncio.to_thread(
                api,
                f"/polls/{poll['id']}/votes",
                {"user": person, "option_index": option(word, fallback)},
            )
            print(f"  {person} voted {poll['options'][option(word, fallback)]}")
        await asyncio.sleep(2.5)
        await jordan.say("ramen it is then 🍜", pause=0.5)


async def plan_scene() -> None:
    room = room_id()
    async with (
        Person("Alex", room) as alex,
        Person("Taylor", room) as taylor,
        Person("Jordan", room) as jordan,
    ):
        await asyncio.sleep(1)
        await alex.say(
            "Should we do a quick call tomorrow at 7pm to go over the plan?"
        )
        await taylor.say("7 works for me")
        first = await alex.wait_for(
            lambda e: e["type"] == "nudge" and e["nudge"]["type"] == "event",
            SUGGESTION_TIMEOUT,
        )
        if not first:
            raise DemoError("No event suggestion arrived; check the AI service logs.")
        print(f"  (event card: {first['nudge'].get('start_at')})")
        await asyncio.sleep(4)
        await jordan.say("Can we make it 8? I've got training until 7:30")
        await alex.say("8pm then")
        await taylor.say("👍", pause=0.3)
        moved = await alex.wait_for(
            lambda e: e["type"] == "nudge" and e["nudge"].get("replaces"),
            SUGGESTION_TIMEOUT,
        )
        if not moved:
            raise DemoError("The event card didn't update; check the AI service logs.")
        print(f"  (card updated: {moved['nudge'].get('start_at')})")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("action", choices=["reset", "poll", "plan"])
    args = parser.parse_args()
    try:
        if args.action == "reset":
            reset()
        else:
            print(f"Playing the {args.action} scene…")
            asyncio.run(poll_scene() if args.action == "poll" else plan_scene())
            print("Done.")
    except DemoError as exc:
        print(f"Demo failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
