import asyncio

import replies
from replies import Replies
from test_nudge_graph import CHAT, FakeModel


def run(raw: Replies, user="Sam", style=("lol ok", "see u there 😂"), messages=CHAT):
    model = FakeModel(Replies=raw)
    return asyncio.run(replies.suggest(model, messages, user, list(style))), model


def test_replies_are_cleaned_and_checked():
    said = CHAT[-1]["text"]
    raw = Replies(
        replies=[' "sounds good" ', "Sam: im in", "SOUNDS GOOD!", said, "", "x" * 200]
        + ["👍", "a", "b"]
    )
    result, model = run(raw, user="Riley")
    assert result == ["sounds good", "Sam: im in", "👍"], (
        "trimmed, unquoted, deduplicated, short, and never a copy of the chat"
    )
    prompt = model.calls[0][1][1][1]
    assert "see u there 😂" in prompt and "CONVERSATION" in prompt


def test_name_prefix_and_copies_are_dropped():
    user = "Morgan" if CHAT[-1]["user"] != "Morgan" else "Riley"
    raw = Replies(replies=[f"{user}: im in", CHAT[0]["text"], "nah", "nah."])
    result, _ = run(raw, user=user)
    assert result == ["im in", "nah"]


def test_no_replies_to_your_own_message():
    result, model = run(Replies(replies=["hi"]), user=CHAT[-1]["user"])
    assert result == [] and model.calls == []
