"""Smart replies: three short things `user` might send next, written the way they write.

The model sees the recent conversation plus a sample of the user's own earlier messages,
which are there only for voice (length, capitals, punctuation, emoji, slang), never for
content. Replies are checked in code: trimmed, deduplicated, short, and never a copy of
something already said.
"""

import re

from pydantic import BaseModel, Field

from nudge_graph import UNTRUSTED, transcript

CONTEXT = 30  # most recent messages of the conversation
STYLE = 40  # most recent messages of the user's own
MAX_REPLIES, MAX_LENGTH = 3, 120

PROMPT = f"""You suggest replies for one person in a group chat: three short messages they could send next. {UNTRUSTED}

Write exactly as this person writes. Their own earlier messages are under STYLE: copy their length, capitals, punctuation, emoji and slang. If they write in lowercase with no full stops, so do you. STYLE is only for how they write: never bring up what those messages talk about.

- Answer the newest message from someone else, as this person, using what the conversation says.
- The three replies must differ: e.g. yes, no or a question back, or different options when the group is choosing.
- Each reply is at most 15 words. No quotation marks, no name in front, no explanations.
- Never invent plans, times, places or facts that the conversation doesn't support."""


class Replies(BaseModel):
    replies: list[str] = Field(default_factory=list)


def _key(text: str) -> str:
    # Emoji-only text has no words, so it is compared as written.
    return re.sub(r"[^\w]+", " ", text.lower()).strip() or text.strip()


def _clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip("\"“”'").strip()


async def suggest(
    model, messages: list[dict], user: str, style: list[str]
) -> list[str]:
    window = [m for m in messages if isinstance(m.get("id"), int)][-CONTEXT:]
    if not window or window[-1].get("user") == user:
        return []
    samples = [s.strip() for s in style if isinstance(s, str) and s.strip()][-STYLE:]
    voice = "\n".join(f"- {s[:200]}" for s in samples) or "(none yet: write casually)"
    structured = model.with_structured_output(Replies, method="json_schema")
    raw: Replies = await structured.ainvoke(
        [
            ("system", PROMPT),
            (
                "human",
                f"You write as: {user}\n\nSTYLE ({user}'s earlier messages):\n{voice}"
                f"\n\nCONVERSATION:\n{transcript(window, set())}",
            ),
        ]
    )

    said = {_key(str(m.get("text", ""))) for m in window}
    kept, seen = [], set()
    for reply in raw.replies:
        text = _clean(reply)
        # Drop a leading "Sam:" if the model wrote the name.
        text = re.sub(rf"^{re.escape(user)}\s*:\s*", "", text, flags=re.I)
        key = _key(text)
        if not text or len(text) > MAX_LENGTH or key in seen or key in said:
            continue
        seen.add(key)
        kept.append(text)
    return kept[:MAX_REPLIES]
