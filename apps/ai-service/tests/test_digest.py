import asyncio

from fastapi.testclient import TestClient

import digest
import main
from digest import Action, Digest, Item, Topic
from test_nudge_graph import CHAT, FakeModel


def run(raw: Digest, messages=CHAT):
    return asyncio.run(digest.summarise(FakeModel(Digest=raw), messages))


def test_structured_digest_keeps_cited_items():
    raw = Digest(
        headline="  Lunch is on **Saturday** at noon. ",
        topics=[
            Topic(
                title="Lunch",
                points=["Sam suggested **noon**", " "],
                source_message_ids=[2, 3],
            ),
            Topic(title="Ghost", points=["never said"], source_message_ids=[99]),
        ],
        decisions=[Item(text="Lunch at **12:00**", source_message_ids=[2, 3])],
        actions=[
            Action(text="Book a table", owner="Sam", source_message_ids=[2]),
            Action(text="Bring snacks", owner="Morgan", source_message_ids=[3]),
            Action(text="Uncited", owner="Alex", source_message_ids=[]),
        ],
        questions=[Item(text="Where should we eat?", source_message_ids=[1])],
    )
    result = run(raw)
    assert result["headline"] == "Lunch is on **Saturday** at noon."
    assert result["topics"] == [
        {
            "title": "Lunch",
            "points": ["Sam suggested **noon**"],
            "source_message_ids": [2, 3],
        }
    ]
    assert result["decisions"] == [
        {"text": "Lunch at **12:00**", "source_message_ids": [2, 3]}
    ]
    assert result["actions"] == [
        {"text": "Book a table", "source_message_ids": [2], "owner": "Sam"},
        {"text": "Bring snacks", "source_message_ids": [3], "owner": None},
    ], "uncited items go; owners must be people in the chat"
    assert result["questions"][0]["text"] == "Where should we eat?"
    assert result["summary"].splitlines() == [
        "Lunch is on Saturday at noon.",
        "Lunch: Sam suggested noon",
        "Decided: Lunch at 12:00",
        "To do: Book a table (Sam)",
        "To do: Bring snacks",
        "Open: Where should we eat?",
    ]


def test_model_sees_message_ids():
    model = FakeModel(Digest=Digest(headline="x"))
    asyncio.run(digest.summarise(model, CHAT))
    system, human = model.calls[0][1]
    assert "untrusted" in system[1] and "**bold**" in system[1]
    assert "[2] Sat 10 Oct 09:44 Sam: Lunch Saturday at noon?" in human[1]


def test_empty_headline_falls_back_to_the_first_point():
    raw = Digest(
        headline=" ",
        topics=[
            Topic(title="Lunch", points=["Noon on Saturday"], source_message_ids=[2])
        ],
    )
    assert run(raw)["headline"] == "Noon on Saturday"


def test_digest_endpoint_falls_back_to_text_when_structure_fails(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setattr(main, "model", FakeModel(Digest=RuntimeError("bad json")))

    async def plain(prompt, fallback):
        return "Lunch: noon on Saturday"

    monkeypatch.setattr(main, "ask", plain)
    body = TestClient(main.app).post("/digest", json={"messages": CHAT}).json()
    assert body == {"summary": "Lunch: noon on Saturday"}


def test_someone_asked_by_mention_can_own_a_to_do():
    messages = CHAT + [
        {
            "id": 4,
            "room": "demo",
            "user": "Alex",
            "text": "@Jordan can you book the room?",
            "created_at": CHAT[-1]["created_at"],
        }
    ]
    raw = Digest(
        headline="Room needs booking.",
        actions=[Action(text="Book the room", owner="Jordan", source_message_ids=[4])],
    )
    assert run(raw, messages)["actions"][0]["owner"] == "Jordan"
