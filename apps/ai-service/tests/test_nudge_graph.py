import asyncio

import pytest
from fastapi.testclient import TestClient

import main
import nudge_graph
from nudge_graph import Detection, EventDraft, PollDraft

CHAT = [
    {
        "id": 1,
        "room": "demo",
        "user": "Alex",
        "text": "Where should we eat after?",
        "created_at": "2026-10-10T08:30:00+00:00",
    },
    {
        "id": 2,
        "room": "demo",
        "user": "Sam",
        "text": "Lunch Saturday at noon?",
        "created_at": "2026-10-10T08:44:00+00:00",
    },
    {
        "id": 3,
        "room": "demo",
        "user": "Alex",
        "text": "Works for me",
        "created_at": "2026-10-10T08:45:00+00:00",
    },
]


class FakeModel:
    """Stands in for ChatOpenAI: answers each structured call by schema name."""

    def __init__(self, **answers):
        self.answers = answers
        self.calls = []

    def with_structured_output(self, schema, **kwargs):
        model = self

        class Runner:
            async def ainvoke(self, messages):
                model.calls.append((schema.__name__, messages))
                answer = model.answers[schema.__name__]
                if isinstance(answer, Exception):
                    raise answer
                return answer

        return Runner()


def run(model, messages=CHAT, new_ids=None):
    graph = nudge_graph.build_graph(model)
    return asyncio.run(nudge_graph.propose(graph, messages, new_ids))


def event(**overrides):
    fields = dict(
        title="Team lunch",
        description="Sam suggested noon and Alex agreed.",
        day="saturday",
        time="12:00",
        source_message_ids=[2, 3],
        confidence=0.9,
    )
    return EventDraft(**{**fields, **overrides})


def test_event_gets_a_resolved_start_time():
    model = FakeModel(Detection=Detection(kind="event"), EventDraft=event())
    [proposal] = run(model)
    assert proposal == {
        "id": "event-2026-10-10T12:00:00+01:00",
        "type": "event",
        "title": "Team lunch",
        "description": "Sam suggested noon and Alex agreed.",
        "source_message_ids": [2, 3],
        "confidence": 0.9,
        "needs_confirmation": True,
        "start_at": "2026-10-10T12:00:00+01:00",
        "timezone": "Europe/London",
        "question": None,
        "options": None,
    }
    assert [name for name, _ in model.calls] == ["Detection", "EventDraft"]
    assert (
        nudge_graph.describe(proposal)
        == "Add Team lunch on Sat 10 Oct, 12:00 to the calendar?"
    )


def test_event_without_a_clear_time_asks_for_one():
    [proposal] = run(
        FakeModel(Detection=Detection(kind="event"), EventDraft=event(time=None))
    )
    assert proposal["start_at"] is None and proposal["id"] == "event-team-lunch"
    assert "Pick a time" in nudge_graph.describe(proposal)


def test_poll_options_are_cleaned():
    draft = PollDraft(
        question="Where should we eat?",
        options=[" Pizza ", "pizza", "sushi"],
        source_message_ids=[1, 2],
        confidence=0.8,
    )
    [proposal] = run(FakeModel(Detection=Detection(kind="poll"), PollDraft=draft))
    assert proposal["id"] == "poll-pizza-sushi"
    assert (
        proposal["options"] == ["Pizza", "Sushi"]  # trimmed, deduped, capitalised
        and proposal["question"] == "Where should we eat?"
    )
    assert proposal["start_at"] is None and proposal["needs_confirmation"] is True


def test_nothing_detected_stops_after_one_call():
    model = FakeModel(Detection=Detection(kind="none"))
    assert run(model) == []
    assert len(model.calls) == 1


@pytest.mark.parametrize(
    "draft, new_ids",
    [
        (event(source_message_ids=[2, 3]), [1]),  # only cites messages seen before
        (event(source_message_ids=[98, 99]), None),  # ids that don't exist
        (event(confidence=0.3), None),
        (event(title="  "), None),
    ],
)
def test_weak_or_stale_events_are_dropped(draft, new_ids):
    assert (
        run(
            FakeModel(Detection=Detection(kind="event"), EventDraft=draft),
            new_ids=new_ids,
        )
        == []
    )


def test_poll_needs_two_options():
    draft = PollDraft(
        question="Pizza?",
        options=["Pizza", "PIZZA"],
        source_message_ids=[1],
        confidence=0.9,
    )
    assert run(FakeModel(Detection=Detection(kind="poll"), PollDraft=draft)) == []


def test_model_sees_new_markers_and_london_times():
    model = FakeModel(Detection=Detection(kind="none"))
    run(model, new_ids=[3])
    system, human = model.calls[0][1]
    assert "untrusted" in system[1]
    lines = human[1].splitlines()
    assert lines[0] == "[1] Sat 10 Oct 09:30 Alex: Where should we eat after?"
    assert lines[2] == "NEW [3] Sat 10 Oct 09:45 Alex: Works for me"
    assert "Saturday 10 October 2026" in human[1]


def test_no_new_messages_skips_the_model():
    model = FakeModel()
    assert run(model, new_ids=[]) == []
    assert model.calls == []


def test_suggest_endpoint(monkeypatch):
    client = TestClient(main.app)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert client.post("/suggest", json={"messages": CHAT}).json() == {
        "suggestion": "No suggestion",
        "proposals": [],
    }

    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setattr(
        main,
        "graph",
        nudge_graph.build_graph(
            FakeModel(Detection=Detection(kind="event"), EventDraft=event())
        ),
    )
    body = client.post(
        "/suggest", json={"messages": CHAT, "new_message_ids": [3]}
    ).json()
    assert (
        body["suggestion"].startswith("Add Team lunch")
        and body["proposals"][0]["type"] == "event"
    )

    monkeypatch.setattr(
        main,
        "graph",
        nudge_graph.build_graph(FakeModel(Detection=RuntimeError("provider down"))),
    )
    assert client.post("/suggest", json={"messages": CHAT}).json()["proposals"] == []
