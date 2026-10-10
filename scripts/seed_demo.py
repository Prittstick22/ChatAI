# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Seed a repeatable, synthetic group conversation through the public Chat API."""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE = ROOT / "fixtures" / "group_chat.json"
DEFAULT_API_URL = "http://localhost:8000"
TIMEOUT_SECONDS = 18


class SeedError(Exception):
    """A recoverable API, fixture, or safety error while seeding."""


def request(
    base_url: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        headers=headers,
        method="POST" if body else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            content = response.read().decode("utf-8")
            return json.loads(content) if content else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SeedError(f"Chat API returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SeedError(
            f"Could not reach the Chat API at {base_url}: {exc.reason}"
        ) from exc


def load_fixture(path: Path) -> dict[str, Any]:
    try:
        fixture = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SeedError(f"Could not read fixture {path}: {exc}") from exc

    required = {"room_name", "created_by", "members", "seed_marker", "messages"}
    if not isinstance(fixture, dict) or not required <= fixture.keys():
        raise SeedError(f"Fixture must contain: {', '.join(sorted(required))}")
    messages = fixture["messages"]
    if not isinstance(messages, list) or not messages:
        raise SeedError("Fixture messages must be a non-empty array")
    if not any(
        message.get("user") == fixture["created_by"]
        and message.get("text") == fixture["seed_marker"]
        for message in messages
    ):
        raise SeedError("Fixture must include its seed_marker as a message")
    return fixture


def message_counts(messages: list[dict[str, Any]]) -> Counter[tuple[str, str]]:
    return Counter((message["user"], message["text"]) for message in messages)


def run(api_url: str, fixture_path: Path) -> tuple[str, int, int]:
    fixture = load_fixture(fixture_path)
    api_url = api_url.rstrip("/")
    creator = fixture["created_by"]
    expected_members = set(fixture["members"]) | {creator}
    if not fixture["members"] or expected_members == {creator}:
        raise SeedError(
            "Fixture must include at least one group member besides the creator"
        )

    request(api_url, "/health")
    rooms = request(api_url, "/rooms")
    matches = [room for room in rooms if room.get("name") == fixture["room_name"]]

    if len(matches) > 1:
        raise SeedError(
            f"More than one room is named {fixture['room_name']!r}; refusing to guess"
        )
    if matches:
        room = matches[0]
        if set(room.get("members", [])) != expected_members:
            raise SeedError(
                f"Room {fixture['room_name']!r} already exists with different members; "
                "rename the fixture room before seeding"
            )
    else:
        room = request(
            api_url,
            "/rooms",
            {
                "name": fixture["room_name"],
                "created_by": creator,
                "members": fixture["members"],
            },
        )

    room_id = room["id"]
    room_query = urllib.parse.urlencode({"room": room_id})
    history = request(api_url, f"/messages?{room_query}")
    marker_present = any(
        message.get("user") == creator and message.get("text") == fixture["seed_marker"]
        for message in history
    )
    if history and not marker_present:
        raise SeedError(
            f"Room {fixture['room_name']!r} already contains messages but not this seed marker; "
            "refusing to mix fixture data into an existing conversation"
        )

    expected = message_counts(fixture["messages"])
    present = message_counts(history)
    missing: list[dict[str, str]] = []
    for message in fixture["messages"]:
        key = (message["user"], message["text"])
        if present[key] < expected[key]:
            missing.append(message)
            present[key] += 1

    for message in missing:
        request(
            api_url,
            "/messages",
            {**message, "room": room_id},
        )

    verified = request(api_url, f"/messages?{room_query}")
    verified_counts = message_counts(verified)
    remaining = expected - verified_counts
    if remaining:
        raise SeedError(
            f"Seed verification failed; {sum(remaining.values())} fixture messages are missing"
        )

    return room_id, len(missing), len(verified)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--api-url",
        default=os.getenv("CHAT_API_URL", DEFAULT_API_URL),
        help="Chat API base URL (default: CHAT_API_URL or %(default)s)",
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        default=DEFAULT_FIXTURE,
        help="Path to the JSON group conversation fixture",
    )
    args = parser.parse_args()

    try:
        room_id, added, total = run(args.api_url, args.fixture)
    except SeedError as exc:
        print(f"Seed failed: {exc}", file=sys.stderr)
        return 1

    print(f"Room: {room_id}")
    print(f"Added: {added} messages; verified fixture history: {total} messages")
    queries = "; ".join(
        item["query"] for item in load_fixture(args.fixture).get("smoke_queries", [])
    )
    if queries:
        print(f"Smoke queries: {queries}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
