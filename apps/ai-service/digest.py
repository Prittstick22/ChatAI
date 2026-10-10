"""Structured catch-up: what someone who missed the chat needs to know, as a headline,
topics, decisions, to-dos and open questions. Every item cites the messages it came
from, and anything citing a message we didn't send is dropped, so the summary can't
point at something nobody said.
"""

import re

from pydantic import BaseModel, Field

from nudge_graph import UNTRUSTED, transcript

CONTEXT = 100
MENTION = re.compile(r"@(\w+)")
MAX_TOPICS, MAX_POINTS, MAX_ITEMS = 5, 3, 5

PROMPT = f"""You write the catch-up for a group chat: what someone who missed it needs to know. {UNTRUSTED}

- headline: one sentence of at most 16 words with the most important thing right now, e.g. "Filming moved to **3pm**; lunch is still undecided." No greeting.
- topics: 2 to 5 threads of the conversation, newest first. Each has a 1 to 3 word title and 1 to 3 short points of at most 14 words.
- decisions: what the group clearly agreed. Leave out anything only suggested.
- actions: what someone said they would do or was asked to do. owner is the person who will do it, not the one asking ("@Sam can you book the room?" is Sam's), with their name exactly as written in the chat, or null if nobody took it on.
- questions: what was asked and hasn't been answered yet.
- source_message_ids: for every topic and item, the ids of the messages it comes from.

Mark times and dates in **bold** and use no other formatting. When a plan changed, give only the latest version. Never invent facts, names or times."""


class Topic(BaseModel):
    title: str
    points: list[str] = Field(default_factory=list)
    source_message_ids: list[int] = Field(default_factory=list)


class Item(BaseModel):
    text: str
    source_message_ids: list[int] = Field(default_factory=list)


class Action(Item):
    owner: str | None = None


class Digest(BaseModel):
    headline: str
    topics: list[Topic] = Field(default_factory=list)
    decisions: list[Item] = Field(default_factory=list)
    actions: list[Action] = Field(default_factory=list)
    questions: list[Item] = Field(default_factory=list)


def _clean(text: str, limit: int) -> str:
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _sources(ids: list[int], known: set[int]) -> list[int] | None:
    valid = sorted({i for i in ids if i in known})
    return valid or None


def as_text(digest: dict) -> str:
    """Plain-text version for the legacy `summary` field."""
    lines = [digest["headline"]]
    lines += [f"{t['title']}: {'; '.join(t['points'])}" for t in digest["topics"]]
    for label, key in (
        ("Decided", "decisions"),
        ("To do", "actions"),
        ("Open", "questions"),
    ):
        for item in digest[key]:
            owner = f" ({item['owner']})" if item.get("owner") else ""
            lines.append(f"{label}: {item['text']}{owner}")
    return "\n".join(lines).replace("**", "")


async def summarise(model, messages: list[dict]) -> dict:
    """Run the structured summary and validate it against the messages sent."""
    window = [m for m in messages if isinstance(m.get("id"), int)][-CONTEXT:]
    known = {m["id"] for m in window}
    # Owners must be people in the chat: anyone who wrote, or was @mentioned.
    people = {str(m.get("user")) for m in window} | {
        name for m in window for name in MENTION.findall(str(m.get("text", "")))
    }
    structured = model.with_structured_output(Digest, method="json_schema")
    raw: Digest = await structured.ainvoke(
        [("system", PROMPT), ("human", transcript(window, set()))]
    )

    topics = []
    for topic in raw.topics:
        points = [_clean(p, 160) for p in topic.points if p.strip()][:MAX_POINTS]
        ids = _sources(topic.source_message_ids, known)
        if topic.title.strip() and points and ids:
            topics.append(
                {
                    "title": _clean(topic.title, 40),
                    "points": points,
                    "source_message_ids": ids,
                }
            )

    def items(raw_items, with_owner=False):
        kept = []
        for item in raw_items:
            ids = _sources(item.source_message_ids, known)
            if not item.text.strip() or not ids:
                continue
            entry = {"text": _clean(item.text, 200), "source_message_ids": ids}
            if with_owner:
                entry["owner"] = item.owner if item.owner in people else None
            kept.append(entry)
        return kept[:MAX_ITEMS]

    headline = _clean(raw.headline, 160)
    if not headline and topics:
        headline = topics[0]["points"][0]
    digest = {
        "headline": headline,
        "topics": topics[:MAX_TOPICS],
        "decisions": items(raw.decisions),
        "actions": items(raw.actions, with_owner=True),
        "questions": items(raw.questions),
    }
    return {"summary": as_text(digest), **digest}
