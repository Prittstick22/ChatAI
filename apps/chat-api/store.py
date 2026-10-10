"""SQLite persistence for the chat API: versioned schema migrations and queries.

Every function opens its own short-lived connection, so the module is safe to call
from FastAPI's threadpool and from async handlers alike.
"""

import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

DEFAULT_ROOM = "demo"
DEFAULT_ROOM_NAME = "Hackathon team"
PAGE_LIMIT = 100
PREVIEW_CHARS = 140

# Applied in order; PRAGMA user_version records how many have run. Never edit an
# applied migration, append a new one instead.
MIGRATIONS = [
    # 1: the original scaffold schema. IF NOT EXISTS lets databases created before
    # migrations existed adopt it unchanged.
    """
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, user TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS polls(id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, options TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS votes(poll_id INTEGER NOT NULL, user TEXT NOT NULL, option_index INTEGER NOT NULL, PRIMARY KEY(poll_id, user));
    """,
    # 2: rooms, replies, edits, soft deletes, reactions, read positions, poll rooms.
    """
    ALTER TABLE messages ADD COLUMN reply_to INTEGER;
    ALTER TABLE messages ADD COLUMN edited_at TEXT;
    ALTER TABLE messages ADD COLUMN deleted_at TEXT;
    CREATE INDEX messages_room_id ON messages(room, id);
    CREATE TABLE rooms(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL);
    CREATE TABLE reactions(message_id INTEGER NOT NULL, user TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(message_id, user, emoji));
    CREATE TABLE reads(room TEXT NOT NULL, user TEXT NOT NULL, message_id INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(room, user));
    ALTER TABLE polls ADD COLUMN room TEXT NOT NULL DEFAULT 'demo';
    ALTER TABLE polls ADD COLUMN created_by TEXT;
    ALTER TABLE polls ADD COLUMN created_at TEXT;
    """,
    # 3: full-text search over message text, kept in step by triggers. Also blanks
    # messages deleted before deletes started erasing text.
    """
    UPDATE messages SET text = '' WHERE deleted_at IS NOT NULL;
    CREATE VIRTUAL TABLE messages_fts USING fts5(
        text, content='messages', content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER messages_fts_update AFTER UPDATE OF text ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
    """,
    # 4: explicit participants for newly created private rooms. Rooms with no
    # membership rows predate this feature and remain visible to every demo user.
    """
    CREATE TABLE room_members(
        room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user TEXT NOT NULL,
        PRIMARY KEY(room, user)
    );
    CREATE INDEX room_members_user ON room_members(user, room);
    """,
    # 5: polls posted into the conversation as messages, and at most one poll per AI
    # proposal in a room.
    """
    ALTER TABLE messages ADD COLUMN poll_id INTEGER;
    ALTER TABLE polls ADD COLUMN proposal_id TEXT;
    CREATE UNIQUE INDEX polls_room_proposal ON polls(room, proposal_id) WHERE proposal_id IS NOT NULL;
    """,
]


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


class Conflict(Exception):
    pass


class Invalid(Exception):
    pass


def db_path() -> str:
    return os.getenv("DB_PATH", "chat.db")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(db_path(), timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout = 5000")
    return db


def init() -> None:
    with closing(connect()) as db:
        db.execute("PRAGMA journal_mode = WAL")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        for number, script in enumerate(MIGRATIONS[version:], start=version + 1):
            db.executescript(
                f"BEGIN;\n{script}\nPRAGMA user_version = {number};\nCOMMIT;"
            )
        with db:
            db.execute(
                "INSERT OR IGNORE INTO rooms(id, name, created_by, created_at) VALUES (?, ?, NULL, ?)",
                (DEFAULT_ROOM, DEFAULT_ROOM_NAME, now()),
            )


# ---------------------------------------------------------------- messages

MESSAGE_SELECT = """
SELECT m.id, m.room, m.user, m.text, m.created_at, m.reply_to, m.edited_at, m.deleted_at,
       m.poll_id, p.user AS parent_user, p.text AS parent_text, p.deleted_at AS parent_deleted_at
FROM messages m LEFT JOIN messages p ON p.id = m.reply_to
"""


def _reactions(db: sqlite3.Connection, ids: list[int]) -> dict[int, list[dict]]:
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    rows = db.execute(
        f"SELECT message_id, emoji, user FROM reactions WHERE message_id IN ({marks}) ORDER BY created_at, rowid",
        ids,
    ).fetchall()
    grouped: dict[int, dict[str, list[str]]] = {}
    for row in rows:
        grouped.setdefault(row["message_id"], {}).setdefault(row["emoji"], []).append(
            row["user"]
        )
    return {
        mid: [{"emoji": e, "users": users} for e, users in emojis.items()]
        for mid, emojis in grouped.items()
    }


def _message(
    row: sqlite3.Row, reactions: dict[int, list[dict]], polls: dict[int, dict]
) -> dict:
    deleted = row["deleted_at"] is not None
    preview = None
    if row["reply_to"] is not None and row["parent_user"] is not None:
        parent_deleted = row["parent_deleted_at"] is not None
        preview = {
            "id": row["reply_to"],
            "user": row["parent_user"],
            "text": "" if parent_deleted else row["parent_text"][:PREVIEW_CHARS],
            "deleted": parent_deleted,
        }
    return {
        "id": row["id"],
        "room": row["room"],
        "user": row["user"],
        "text": "" if deleted else row["text"],
        "created_at": row["created_at"],
        "reply_to": row["reply_to"],
        "reply_preview": preview,
        "edited_at": row["edited_at"],
        "deleted": deleted,
        "reactions": [] if deleted else reactions.get(row["id"], []),
        # The poll this message shows in the conversation, if it is one.
        "poll": None if deleted else polls.get(row["poll_id"]),
    }


def _hydrate(db: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[dict]:
    reactions = _reactions(db, [r["id"] for r in rows])
    poll_ids = [r["poll_id"] for r in rows if r["poll_id"] is not None]
    polls = {}
    if poll_ids:
        marks = ",".join("?" * len(poll_ids))
        for p in db.execute(f"SELECT * FROM polls WHERE id IN ({marks})", poll_ids):
            polls[p["id"]] = _poll(db, p)
    return [_message(r, reactions, polls) for r in rows]


def _get(db: sqlite3.Connection, message_id: int) -> dict:
    row = db.execute(MESSAGE_SELECT + "WHERE m.id = ?", (message_id,)).fetchone()
    if row is None:
        raise NotFound("Message not found")
    return _hydrate(db, [row])[0]


def get_message(message_id: int) -> dict:
    with closing(connect()) as db:
        return _get(db, message_id)


def list_messages(
    room: str,
    limit: int = PAGE_LIMIT,
    before_id: int | None = None,
    after_id: int | None = None,
) -> list[dict]:
    """Chronological page of a room. Default and before_id pages are the newest
    messages below the cursor; after_id pages are the oldest messages above it, so a
    reconnecting client can walk forward through everything it missed."""
    limit = max(1, min(limit, PAGE_LIMIT))
    clauses, params = ["m.room = ?"], [room]
    if before_id is not None:
        clauses.append("m.id < ?")
        params.append(before_id)
    if after_id is not None:
        clauses.append("m.id > ?")
        params.append(after_id)
    order = "ASC" if after_id is not None and before_id is None else "DESC"
    with closing(connect()) as db:
        rows = db.execute(
            MESSAGE_SELECT
            + f"WHERE {' AND '.join(clauses)} ORDER BY m.id {order} LIMIT ?",
            (*params, limit),
        ).fetchall()
        if order == "DESC":
            rows = rows[::-1]
        return _hydrate(db, rows)


def recent_for_ai(room: str, limit: int = PAGE_LIMIT) -> list[dict]:
    """Recent visible messages in the stable v1 Message shape the AI service expects.
    A poll reads as its question and current results, and carries its poll_id."""
    keys = ("id", "room", "user", "text", "created_at")
    recent = []
    for m in list_messages(room, limit):
        if m["deleted"]:
            continue
        message = {k: m[k] for k in keys}
        if m["poll"]:
            message["text"] = poll_text(m["poll"])
            message["poll_id"] = m["poll"]["id"]
        recent.append(message)
    return recent


def poll_text(poll: dict) -> str:
    results = ", ".join(
        f"{option} ({count} vote{'' if count == 1 else 's'})"
        for option, count in zip(poll["options"], poll["counts"])
    )
    return f"[Poll] {poll['question']} Options: {results}"


def get_messages(room: str, ids: list[int]) -> list[dict]:
    """The visible messages among `ids` in `room`, in the order given."""
    ids = [i for i in dict.fromkeys(ids) if isinstance(i, int)]
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    with closing(connect()) as db:
        rows = db.execute(
            MESSAGE_SELECT
            + f"WHERE m.room = ? AND m.deleted_at IS NULL AND m.id IN ({marks})",
            (room, *ids),
        ).fetchall()
        found = {m["id"]: m for m in _hydrate(db, rows)}
    return [found[i] for i in ids if i in found]


# ---------------------------------------------------------------- search

SEARCH_LIMIT = 20
STOPWORDS = frozenset(
    "a about an and are as at be but by can could do does for from had has have how i "
    "if in is it its me my of on or our so that the their them then there they this "
    "to up us was we were what when where which who why will with would you your".split()
)
# Control characters FTS5 wraps around each matched term; never typed in chat.
HIT_START, HIT_END = "\x02", "\x03"


def _fts_query(text: str) -> str | None:
    """Turn free text into a safe FTS5 query: every word quoted (so input can never be
    FTS syntax), OR-ed so bm25 ranks messages matching more words first, and the last
    word prefix-matched so a half-typed query still finds something."""
    words = re.findall(r"\w+", text.lower())
    kept = [w for w in words if w not in STOPWORDS] or words
    if not kept:
        return None
    last = kept[-1]
    return " OR ".join(
        f'"{w}"*' if w == last and len(w) >= 3 else f'"{w}"'
        for w in dict.fromkeys(kept)
    )


def _segments(marked: str) -> list[dict]:
    """Split highlight() output into segments: matched words get match=True."""
    parts = re.split(f"[{HIT_START}{HIT_END}]", marked)
    return [{"text": part, "match": i % 2 == 1} for i, part in enumerate(parts) if part]


def search_messages(room: str, text: str, limit: int = SEARCH_LIMIT) -> list[dict]:
    """Full-text search over a room's whole history, best match first. Each message
    gets a `highlight` list of text segments marking the words that matched."""
    query = _fts_query(text)
    if query is None:
        return []
    with closing(connect()) as db:
        hits = db.execute(
            "SELECT messages_fts.rowid AS id, "
            "highlight(messages_fts, 0, char(2), char(3)) AS marked "
            "FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid "
            "WHERE messages_fts MATCH ? AND m.room = ? AND m.deleted_at IS NULL "
            "ORDER BY bm25(messages_fts) LIMIT ?",
            (query, room, limit),
        ).fetchall()
    marked = {h["id"]: h["marked"] for h in hits}
    return [
        {**m, "highlight": _segments(marked[m["id"]])}
        for m in get_messages(room, list(marked))
    ]


def create_message(
    room: str, user: str, text: str, reply_to: int | None = None
) -> dict:
    with closing(connect()) as db:
        if reply_to is not None:
            parent = db.execute(
                "SELECT room FROM messages WHERE id = ?", (reply_to,)
            ).fetchone()
            if parent is None or parent["room"] != room:
                raise Invalid("The message you replied to is not in this room")
        with db:
            cur = db.execute(
                "INSERT INTO messages(room, user, text, created_at, reply_to) VALUES (?, ?, ?, ?, ?)",
                (room, user, text, now(), reply_to),
            )
        return _get(db, cur.lastrowid)


def _own_live_message(
    db: sqlite3.Connection, message_id: int, user: str
) -> sqlite3.Row:
    row = db.execute(
        "SELECT user, deleted_at, poll_id FROM messages WHERE id = ?", (message_id,)
    ).fetchone()
    if row is None:
        raise NotFound("Message not found")
    if row["deleted_at"] is not None:
        raise Conflict("This message was deleted")
    if row["user"] != user:
        raise Forbidden("Only the sender can change this message")
    return row


def edit_message(message_id: int, user: str, text: str) -> dict:
    with closing(connect()) as db:
        if _own_live_message(db, message_id, user)["poll_id"] is not None:
            raise Invalid("A poll can't be edited")
        with db:
            db.execute(
                "UPDATE messages SET text = ?, edited_at = ? WHERE id = ?",
                (text, now(), message_id),
            )
        return _get(db, message_id)


def delete_message(message_id: int, user: str) -> dict:
    with closing(connect()) as db:
        _own_live_message(db, message_id, user)
        with db:
            # Erase the text too, so "delete for everyone" doesn't leave it in the file.
            db.execute(
                "UPDATE messages SET text = '', deleted_at = ? WHERE id = ?",
                (now(), message_id),
            )
            db.execute("DELETE FROM reactions WHERE message_id = ?", (message_id,))
        return _get(db, message_id)


def toggle_reaction(message_id: int, user: str, emoji: str) -> dict:
    with closing(connect()) as db:
        row = db.execute(
            "SELECT deleted_at FROM messages WHERE id = ?", (message_id,)
        ).fetchone()
        if row is None:
            raise NotFound("Message not found")
        if row["deleted_at"] is not None:
            raise Conflict("This message was deleted")
        with db:
            removed = db.execute(
                "DELETE FROM reactions WHERE message_id = ? AND user = ? AND emoji = ?",
                (message_id, user, emoji),
            ).rowcount
            if not removed:
                db.execute(
                    "INSERT INTO reactions(message_id, user, emoji, created_at) VALUES (?, ?, ?, ?)",
                    (message_id, user, emoji, now()),
                )
        return _get(db, message_id)


# ---------------------------------------------------------------- rooms


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-")
    return slug or "room"


def _room(db: sqlite3.Connection, row: sqlite3.Row, user: str | None) -> dict:
    room_id = row["id"]
    last = db.execute(
        MESSAGE_SELECT + "WHERE m.room = ? ORDER BY m.id DESC LIMIT 1", (room_id,)
    ).fetchone()
    count = db.execute(
        "SELECT COUNT(*) FROM messages WHERE room = ? AND deleted_at IS NULL",
        (room_id,),
    ).fetchone()[0]
    reads = {
        r["user"]: r["message_id"]
        for r in db.execute(
            "SELECT user, message_id FROM reads WHERE room = ?", (room_id,)
        )
    }
    unread = 0
    if user:
        unread = db.execute(
            "SELECT COUNT(*) FROM messages WHERE room = ? AND id > ? AND user != ? AND deleted_at IS NULL",
            (room_id, reads.get(user, 0), user),
        ).fetchone()[0]
    return {
        "id": room_id,
        "name": row["name"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "members": [
            r["user"]
            for r in db.execute(
                "SELECT user FROM room_members WHERE room = ? ORDER BY rowid",
                (room_id,),
            )
        ],
        "last_message": _hydrate(db, [last])[0] if last else None,
        "message_count": count,
        "unread": unread,
        "reads": reads,
    }


def list_rooms(user: str | None = None) -> list[dict]:
    """Rooms visible to the user, with their latest message first.

    Rooms without membership rows are legacy shared rooms and stay visible to all
    demo users for backward compatibility.
    """
    with closing(connect()) as db:
        query = "SELECT * FROM rooms"
        params: tuple[str, ...] = ()
        if user:
            query += """
                WHERE NOT EXISTS (
                    SELECT 1 FROM room_members rm WHERE rm.room = rooms.id
                ) OR EXISTS (
                    SELECT 1 FROM room_members rm
                    WHERE rm.room = rooms.id AND rm.user = ?
                )
            """
            params = (user,)
        rooms = [_room(db, row, user) for row in db.execute(query, params)]
    return sorted(
        rooms, key=lambda r: (r["last_message"] or r)["created_at"], reverse=True
    )


def create_room(
    name: str, created_by: str | None = None, members: list[str] | None = None
) -> dict:
    with closing(connect()) as db:
        base = _slug(name)
        taken = {
            r[0]
            for r in db.execute(
                "SELECT id FROM rooms WHERE id = ? OR id LIKE ?", (base, base + "-%")
            )
        }
        room_id, n = base, 2
        while room_id in taken:
            room_id, n = f"{base}-{n}", n + 1
        with db:
            db.execute(
                "INSERT INTO rooms(id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
                (room_id, name, created_by, now()),
            )
            if members is not None:
                participants = list(
                    dict.fromkeys(([created_by] if created_by else []) + members)
                )
                db.executemany(
                    "INSERT INTO room_members(room, user) VALUES (?, ?)",
                    [(room_id, user) for user in participants],
                )
        return _room(
            db,
            db.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone(),
            created_by,
        )


def mark_read(room: str, user: str, message_id: int) -> tuple[int, bool]:
    """Move a user's read position forward (never back). Returns the position and
    whether it moved."""
    with closing(connect()) as db:
        latest = (
            db.execute(
                "SELECT MAX(id) FROM messages WHERE room = ?", (room,)
            ).fetchone()[0]
            or 0
        )
        before = db.execute(
            "SELECT message_id FROM reads WHERE room = ? AND user = ?", (room, user)
        ).fetchone()
        with db:
            db.execute(
                """INSERT INTO reads(room, user, message_id, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(room, user) DO UPDATE SET message_id = MAX(message_id, excluded.message_id),
                   updated_at = excluded.updated_at""",
                (room, user, min(message_id, latest), now()),
            )
        position = db.execute(
            "SELECT message_id FROM reads WHERE room = ? AND user = ?", (room, user)
        ).fetchone()[0]
        return position, before is None or position != before[0]


# ---------------------------------------------------------------- polls


def _poll(db: sqlite3.Connection, row: sqlite3.Row) -> dict:
    options = json.loads(row["options"])
    votes = {
        r["user"]: r["option_index"]
        for r in db.execute(
            "SELECT user, option_index FROM votes WHERE poll_id = ?", (row["id"],)
        )
    }
    message = db.execute(
        "SELECT id FROM messages WHERE poll_id = ?", (row["id"],)
    ).fetchone()
    counts = [0] * len(options)
    for index in votes.values():
        if 0 <= index < len(counts):
            counts[index] += 1
    return {
        "id": row["id"],
        "question": row["question"],
        "options": options,
        "room": row["room"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "counts": counts,
        "votes": votes,
        # The AI proposal it was made from, and the message showing it in the chat.
        "proposal_id": row["proposal_id"],
        "message_id": message["id"] if message else None,
    }


def list_polls(room: str | None = None) -> list[dict]:
    with closing(connect()) as db:
        if room is None:
            rows = db.execute("SELECT * FROM polls ORDER BY id DESC").fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM polls WHERE room = ? ORDER BY id DESC", (room,)
            ).fetchall()
        return [_poll(db, r) for r in rows]


def create_poll(
    question: str,
    options: list[str],
    room: str,
    created_by: str | None,
    proposal_id: str | None = None,
) -> tuple[dict, dict | None]:
    """Create a poll and the message that shows it in the conversation. A room gets one
    poll per AI proposal: asking again returns the existing poll and no message."""
    with closing(connect()) as db:
        try:
            with db:
                cur = db.execute(
                    "INSERT INTO polls(question, options, room, created_by, created_at, proposal_id) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        question,
                        json.dumps(options),
                        room,
                        created_by,
                        now(),
                        proposal_id,
                    ),
                )
                poll_id = cur.lastrowid
                cur = db.execute(
                    "INSERT INTO messages(room, user, text, created_at, poll_id) VALUES (?, ?, ?, ?, ?)",
                    (room, created_by or "Someone", question, now(), poll_id),
                )
        except sqlite3.IntegrityError:
            row = db.execute(
                "SELECT * FROM polls WHERE room = ? AND proposal_id = ?",
                (room, proposal_id),
            ).fetchone()
            return _poll(db, row), None
        message = _get(db, cur.lastrowid)
        return message["poll"], message


def vote(poll_id: int, user: str, option_index: int) -> dict:
    with closing(connect()) as db:
        row = db.execute("SELECT * FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if row is None:
            raise NotFound("Poll not found")
        if not 0 <= option_index < len(json.loads(row["options"])):
            raise Invalid("Invalid option")
        with db:
            db.execute(
                "INSERT OR REPLACE INTO votes(poll_id, user, option_index) VALUES (?, ?, ?)",
                (poll_id, user, option_index),
            )
        return _poll(db, row)


# ---------------------------------------------------------------- dev tools


def backup(directory: str) -> str:
    """Snapshot the whole database into `directory`; returns the copy's path."""
    os.makedirs(directory, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(directory, f"chat.{stamp}.db")
    with closing(connect()) as db, closing(sqlite3.connect(path)) as copy:
        db.backup(copy)
    return path


TABLES = ("votes", "polls", "reactions", "reads", "room_members", "messages", "rooms")


def wipe() -> None:
    """Delete every room, message, poll and read position, and number messages from 1
    again. The default room comes back, empty."""
    with closing(connect()) as db:
        with db:
            for table in TABLES:
                db.execute(f"DELETE FROM {table}")
            db.execute("DELETE FROM sqlite_sequence")
    init()


def clear_room(room: str) -> None:
    """Delete a room's messages, polls, reactions and read positions. The room and its
    members stay."""
    with closing(connect()) as db:
        with db:
            db.execute(
                "DELETE FROM votes WHERE poll_id IN (SELECT id FROM polls WHERE room = ?)",
                (room,),
            )
            db.execute("DELETE FROM polls WHERE room = ?", (room,))
            db.execute(
                "DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE room = ?)",
                (room,),
            )
            db.execute("DELETE FROM reads WHERE room = ?", (room,))
            db.execute("DELETE FROM messages WHERE room = ?", (room,))


def delete_room(room: str) -> None:
    clear_room(room)
    with closing(connect()) as db:
        with db:
            db.execute("DELETE FROM room_members WHERE room = ?", (room,))
            db.execute("DELETE FROM rooms WHERE id = ?", (room,))


def insert_history(room: str, messages: list[dict]) -> list[int]:
    """Add messages that keep their own `created_at` (seeded history), oldest first.
    Returns their ids."""
    with closing(connect()) as db:
        with db:
            return [
                db.execute(
                    "INSERT INTO messages(room, user, text, created_at) VALUES (?, ?, ?, ?)",
                    (room, m["user"], m["text"], m["created_at"]),
                ).lastrowid
                for m in messages
            ]
