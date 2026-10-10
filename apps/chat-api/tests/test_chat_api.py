import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

import main
import store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "chat.db"))
    # Nothing listens on the discard port, so every AI call takes the fallback path.
    monkeypatch.setattr(main, "AI_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("NUDGE_DEBOUNCE", "0")
    with TestClient(main.app) as c:
        yield c


def post(client, text, user="Alex", room="demo", **extra):
    r = client.post(
        "/messages", json={"user": user, "text": text, "room": room, **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()


def receive(ws, kind, limit=10):
    for _ in range(limit):
        event = ws.receive_json()
        if event["type"] == kind:
            return event
    raise AssertionError(f"no {kind} event")


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_post_and_list_keeps_v1_shape(client):
    sent = post(client, "  Meet Saturday at noon  ", client_id="tmp-1")
    assert sent["text"] == "Meet Saturday at noon"
    assert sent["client_id"] == "tmp-1"
    listed = client.get("/messages?room=demo").json()
    assert [m["id"] for m in listed] == [sent["id"]]
    message = listed[0]
    assert {"id", "room", "user", "text", "created_at"} <= message.keys()
    assert (
        message["reactions"] == []
        and message["deleted"] is False
        and "client_id" not in message
    )
    assert client.get("/messages").json() == listed, "room defaults to demo"


@pytest.mark.parametrize(
    "payload",
    [
        {"user": "Alex", "text": "   "},
        {"user": "", "text": "hi"},
        {"user": "Alex", "text": "x" * 2001},
        {"user": "Alex"},
    ],
)
def test_rejects_empty_or_oversized_messages(client, payload):
    assert client.post("/messages", json=payload).status_code == 422


def test_replies_carry_a_preview(client):
    parent = post(client, "Pizza or sushi?")
    reply = post(client, "Pizza", user="Sam", reply_to=parent["id"])
    assert reply["reply_to"] == parent["id"]
    assert reply["reply_preview"] == {
        "id": parent["id"],
        "user": "Alex",
        "text": "Pizza or sushi?",
        "deleted": False,
    }
    other = post(client, "elsewhere", room="other")
    r = client.post(
        "/messages", json={"user": "Sam", "text": "x", "reply_to": other["id"]}
    )
    assert r.status_code == 400
    assert (
        client.post(
            "/messages", json={"user": "Sam", "text": "x", "reply_to": 999}
        ).status_code
        == 400
    )


def test_only_the_sender_can_edit_or_delete(client):
    m = post(client, "Meet at 12")
    assert (
        client.patch(
            f"/messages/{m['id']}", json={"user": "Sam", "text": "hacked"}
        ).status_code
        == 403
    )
    edited = client.patch(
        f"/messages/{m['id']}", json={"user": "Alex", "text": "Meet at 1"}
    ).json()
    assert edited["text"] == "Meet at 1" and edited["edited_at"]
    assert client.delete(f"/messages/{m['id']}?user=Sam").status_code == 403
    deleted = client.delete(f"/messages/{m['id']}?user=Alex").json()
    assert deleted["deleted"] is True and deleted["text"] == ""
    assert (
        client.patch(
            f"/messages/{m['id']}", json={"user": "Alex", "text": "again"}
        ).status_code
        == 409
    )
    assert (
        client.patch("/messages/999", json={"user": "Alex", "text": "x"}).status_code
        == 404
    )


def test_deleting_a_parent_updates_reply_previews(client):
    parent = post(client, "secret plan")
    reply = post(client, "ok", user="Sam", reply_to=parent["id"])
    client.delete(f"/messages/{parent['id']}?user=Alex")
    with sqlite3.connect(store.db_path()) as db:
        stored = db.execute(
            "SELECT text FROM messages WHERE id = ?", (parent["id"],)
        ).fetchone()
    assert stored == ("",), "deleted text must not stay in the database"
    listed = {m["id"]: m for m in client.get("/messages").json()}
    assert listed[reply["id"]]["reply_preview"] == {
        "id": parent["id"],
        "user": "Alex",
        "text": "",
        "deleted": True,
    }


def test_reactions_toggle_per_user(client):
    m = post(client, "We won!")
    url = f"/messages/{m['id']}/reactions"
    client.post(url, json={"user": "Sam", "emoji": "🎉"})
    client.post(url, json={"user": "Jordan", "emoji": "🎉"})
    r = client.post(url, json={"user": "Sam", "emoji": "👍"}).json()
    assert r["reactions"] == [
        {"emoji": "🎉", "users": ["Sam", "Jordan"]},
        {"emoji": "👍", "users": ["Sam"]},
    ]
    r = client.post(url, json={"user": "Sam", "emoji": "🎉"}).json()
    assert r["reactions"] == [
        {"emoji": "🎉", "users": ["Jordan"]},
        {"emoji": "👍", "users": ["Sam"]},
    ]
    client.delete(f"/messages/{m['id']}?user=Alex")
    assert client.post(url, json={"user": "Sam", "emoji": "🎉"}).status_code == 409
    assert (
        client.post(
            "/messages/999/reactions", json={"user": "Sam", "emoji": "🎉"}
        ).status_code
        == 404
    )


def test_pagination_cursors(client):
    ids = [post(client, f"m{i}")["id"] for i in range(5)]
    assert [m["id"] for m in client.get("/messages?limit=2").json()] == ids[3:]
    assert [
        m["id"] for m in client.get(f"/messages?limit=2&before_id={ids[3]}").json()
    ] == ids[1:3]
    assert [
        m["id"] for m in client.get(f"/messages?limit=2&after_id={ids[0]}").json()
    ] == ids[1:3]
    assert client.get("/messages?limit=500").status_code == 422


def test_rooms_unread_and_read_positions(client):
    rooms = client.get("/rooms").json()
    assert [r["id"] for r in rooms] == ["demo"] and rooms[0]["name"] == "Hackathon team"

    food = client.post("/rooms", json={"name": "Food run!", "created_by": "Sam"}).json()
    again = client.post("/rooms", json={"name": "food run", "created_by": "Sam"}).json()
    assert (food["id"], again["id"]) == ("food-run", "food-run-2")
    assert client.post("/rooms", json={"name": "  "}).status_code == 422

    a = post(client, "lunch?", user="Sam", room="food-run")
    b = post(client, "pizza", user="Sam", room="food-run")
    post(client, "mine", user="Alex", room="food-run")
    by_id = {r["id"]: r for r in client.get("/rooms?user=Alex").json()}
    assert client.get("/rooms?user=Alex").json()[0]["id"] == "food-run", (
        "most recent activity first"
    )
    assert by_id["food-run"]["unread"] == 2, "own messages never count as unread"
    assert by_id["food-run"]["last_message"]["text"] == "mine"

    r = client.post(
        "/rooms/food-run/read", json={"user": "Alex", "message_id": a["id"]}
    ).json()
    assert r["message_id"] == a["id"]
    assert (
        client.post(
            "/rooms/food-run/read", json={"user": "Alex", "message_id": 0}
        ).json()["message_id"]
        == a["id"]
    ), "never moves back"
    room = {r["id"]: r for r in client.get("/rooms?user=Alex").json()}["food-run"]
    assert room["unread"] == 1 and room["reads"] == {"Alex": a["id"]}
    assert (
        client.post(
            "/rooms/food-run/read", json={"user": "Alex", "message_id": 10**6}
        ).json()["message_id"]
        >= b["id"]
    )


def test_websocket_events(client):
    with client.websocket_connect("/ws?user=Sam&room=demo") as sam:
        assert receive(sam, "presence")["online"] == ["Sam"]
        with client.websocket_connect("/ws?user=Alex") as alex:
            assert receive(sam, "presence")["online"] == ["Alex", "Sam"]

            post(client, "not for Sam", room="other")
            demo = post(client, "for Sam", client_id="c1")
            got = receive(sam, "message")["message"]
            assert got["id"] == demo["id"] and got["client_id"] == "c1", (
                "other rooms are filtered out"
            )
            assert receive(alex, "message")["message"]["room"] == "other", (
                "unfiltered clients see every room"
            )

            alex.send_json({"type": "typing", "room": "demo"})
            assert receive(sam, "typing") == {
                "type": "typing",
                "room": "demo",
                "user": "Alex",
                "active": True,
            }
            alex.send_text("not json")
            alex.send_json({"type": "ping"})
            assert receive(alex, "pong") == {"type": "pong"}

            client.post(
                f"/messages/{demo['id']}/reactions",
                json={"user": "Alex", "emoji": "👍"},
            )
            assert receive(sam, "message_updated")["message"]["reactions"][0][
                "users"
            ] == ["Alex"]
            client.post(
                "/rooms/demo/read", json={"user": "Alex", "message_id": demo["id"]}
            )
            assert receive(sam, "read") == {
                "type": "read",
                "room": "demo",
                "user": "Alex",
                "message_id": demo["id"],
            }
        assert receive(sam, "presence")["online"] == ["Sam"]


def test_polls_tally_votes(client):
    p = client.post(
        "/polls", json={"question": "Pick a day", "options": ["Saturday", "Sunday"]}
    ).json()
    assert p["counts"] == [0, 0] and p["room"] == "demo"
    client.post(f"/polls/{p['id']}/votes", json={"user": "Alex", "option_index": 0})
    client.post(f"/polls/{p['id']}/votes", json={"user": "Sam", "option_index": 0})
    r = client.post(
        f"/polls/{p['id']}/votes", json={"user": "Alex", "option_index": 1}
    ).json()
    assert (
        r["ok"] is True
        and r["poll"]["counts"] == [1, 1]
        and r["poll"]["votes"] == {"Alex": 1, "Sam": 0}
    )
    assert client.get("/polls").json()[0]["counts"] == [1, 1]
    assert (
        client.post(
            f"/polls/{p['id']}/votes", json={"user": "Alex", "option_index": 5}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/polls/999/votes", json={"user": "Alex", "option_index": 0}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/polls", json={"question": "One?", "options": ["only"]}
        ).status_code
        == 422
    )


def test_ai_routes_fall_back_when_ai_is_down(client):
    post(client, "Meeting at noon tomorrow")
    gone = post(client, "meeting secret")
    client.delete(f"/messages/{gone['id']}?user=Alex")
    assert "unavailable" in client.get("/digest").json()["summary"]
    search = client.get("/search?query=meeting").json()
    assert search["mode"] == "keyword"
    assert [m["text"] for m in search["results"]] == ["Meeting at noon tomorrow"], (
        "deleted messages never reach AI"
    )
    assert client.get("/suggest").json() == {"suggestion": "No suggestion"}


def search(client, query, room="demo"):
    r = client.get("/search", params={"query": query, "room": room})
    assert r.status_code == 200, r.text
    return r.json()


def test_keyword_search_finds_word_forms_and_highlights(client):
    hit = post(client, "Booked the library meeting room for Saturday")
    post(client, "Pizza or sushi?", user="Sam")
    post(client, "library elsewhere", room="other")
    for query in ("library", "meetings", "meet", "libr", "LIBRARY?"):
        found = search(client, query)
        assert [m["id"] for m in found["results"]] == [hit["id"]], query
    [result] = search(client, "library")["results"]
    assert result["match"] == ["keyword"]
    assert result["highlight"] == [
        {"text": "Booked the ", "match": False},
        {"text": "library", "match": True},
        {"text": " meeting room for Saturday", "match": False},
    ]
    assert search(client, "")["results"] == []


def test_keyword_search_ranks_more_matching_words_first(client):
    one = post(client, "the room is booked")
    both = post(client, "library room booked for noon")
    ids = [m["id"] for m in search(client, "library room")["results"]]
    assert ids == [both["id"], one["id"]]


def test_keyword_search_follows_edits_and_deletes(client):
    m = post(client, "Meet at the library")
    client.patch(
        f"/messages/{m['id']}", json={"user": "Alex", "text": "Meet at the gym"}
    )
    assert search(client, "library")["results"] == []
    assert [r["id"] for r in search(client, "gym")["results"]] == [m["id"]]
    client.delete(f"/messages/{m['id']}?user=Alex")
    assert search(client, "gym")["results"] == []


@pytest.mark.parametrize(
    "query", ['"', "AND", "NEAR(", "*", "-meeting", "text:meeting", "a OR", "'; DROP"]
)
def test_search_input_is_never_fts_syntax(client, query):
    post(client, "meeting text AND near")
    assert isinstance(search(client, query)["results"], list)


def test_search_merges_keyword_and_semantic_rankings(client, monkeypatch):
    exact = post(client, "Library opens at nine")
    meaning = post(client, "Saturday at noon works for everyone", user="Sam")
    elsewhere = post(client, "Saturday elsewhere", room="other")
    gone = post(client, "Saturday maybe")
    client.delete(f"/messages/{gone['id']}?user=Alex")

    async def fake_ai(path, payload, fallback):
        assert path == "/search" and payload["query"] == "when is the library meetup"
        ids = [meaning["id"], exact["id"], elsewhere["id"], gone["id"], "junk"]
        return {"results": [{"id": i} for i in ids], "mode": "semantic"}

    monkeypatch.setattr(main, "ai_call", fake_ai)
    found = search(client, "when is the library meetup")
    assert found["mode"] == "semantic"
    assert [(m["id"], m["match"]) for m in found["results"]] == [
        (exact["id"], ["keyword", "semantic"]),
        (meaning["id"], ["semantic"]),
    ], "found by both first; other rooms and deleted messages never returned"
    assert found["results"][1]["highlight"] is None
    assert found["results"][1]["text"] == "Saturday at noon works for everyone"


def wait_for(condition, seconds=3):
    deadline = time.monotonic() + seconds
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


POLL = {
    "id": "poll-pizza-sushi",
    "type": "poll",
    "question": "Where should we eat?",
    "options": ["Pizza", "Sushi"],
    "needs_confirmation": True,
}


def test_nudges_reach_the_room_once(client):
    nudger = main.app.state.nudger
    calls = []

    async def fake_ask(path, payload, fallback):
        calls.append(payload["new_message_ids"])
        newest = payload["new_message_ids"][-1]
        return {
            "proposals": [
                {**POLL, "source_message_ids": [newest]},
                {
                    "id": "ghost",
                    "type": "event",
                    "title": "x",
                    "source_message_ids": [999],
                },
                {
                    "id": "junk",
                    "type": "poll",
                    "question": "?",
                    "options": ["one"],
                    "source_message_ids": [newest],
                },
            ]
        }

    nudger.ask = fake_ask
    with client.websocket_connect("/ws?user=Sam&room=demo") as ws:
        first = post(client, "pizza or sushi?")
        nudge = receive(ws, "nudge")
        assert nudge == {
            "type": "nudge",
            "room": "demo",
            "nudge": {**POLL, "source_message_ids": [first["id"]]},
        }
        second = post(client, "either works")
        wait_for(lambda: len(calls) == 2)
        time.sleep(0.1)
        ws.send_json({"type": "ping"})
        later = []
        while (event := ws.receive_json())["type"] != "pong":
            later.append(event["type"])
        assert "nudge" not in later, "the same proposal is never pushed twice"
    assert calls == [[first["id"]], [second["id"]]]


def test_nudges_wait_for_a_quiet_moment(client):
    nudger = main.app.state.nudger
    nudger.debounce = 0.3
    calls = []

    async def fake_ask(path, payload, fallback):
        calls.append(
            ([m["id"] for m in payload["messages"]], payload["new_message_ids"])
        )
        return {"proposals": []}

    nudger.ask = fake_ask
    old = store.create_message("demo", "Alex", "seeded before the server started")
    a = post(client, "lunch saturday?")
    b = post(client, "noon works", user="Sam")
    wait_for(lambda: calls)
    time.sleep(0.4)
    assert calls == [([old["id"], a["id"], b["id"]], [a["id"], b["id"]])], (
        "one analysis per burst; earlier history is context, not new"
    )


def stub_summaries(answer="Lunch is pizza on Saturday."):
    summariser = main.app.state.summariser
    calls = []

    async def fake_ask(path, payload, fallback):
        assert path == "/digest"
        calls.append([m["id"] for m in payload["messages"]])
        return {"summary": answer} if answer else fallback

    summariser.ask = fake_ask
    return summariser, calls


def test_summary_after_ten_new_messages(client):
    summariser, calls = stub_summaries()
    summariser.quiet = 60  # only the message count can trigger here
    assert client.get("/rooms/demo/summary").json() == {"summary": None}
    with client.websocket_connect("/ws?user=Sam&room=demo") as ws:
        sent = [post(client, f"message {i}") for i in range(1, 11)]
        event = receive(ws, "summary", limit=40)
    assert len(calls) == 1 and calls[0] == [m["id"] for m in sent]
    summary = event["summary"]
    assert event["room"] == "demo" and summary["text"] == "Lunch is pizza on Saturday."
    assert summary["upto_message_id"] == sent[-1]["id"]
    assert summary["message_count"] == 10 and summary["trigger"] == "messages"
    assert client.get("/rooms/demo/summary").json() == {"summary": summary}


def test_summary_after_a_quiet_moment(client):
    summariser, calls = stub_summaries()
    summariser.quiet = 0.3
    first = [post(client, "lunch?"), post(client, "pizza", user="Sam")]
    time.sleep(0.15)
    assert calls == [], "still within the quiet window"
    wait_for(lambda: calls)
    latest = client.get("/rooms/demo/summary").json()["summary"]
    assert latest["trigger"] == "quiet"
    assert latest["upto_message_id"] == first[-1]["id"]
    time.sleep(0.5)
    assert len(calls) == 1, "no new messages, no new summary"
    later = post(client, "sushi", user="Jordan")
    wait_for(lambda: len(calls) == 2)
    assert calls[1][-1] == later["id"]


def test_ten_message_summary_isnt_repeated_when_the_room_goes_quiet(client):
    summariser, calls = stub_summaries()
    summariser.quiet = 0.3
    for i in range(10):
        post(client, f"message {i}")
    wait_for(lambda: calls)
    time.sleep(0.6)
    assert len(calls) == 1


def test_summarise_now_is_structured_and_shared(client):
    summariser = main.app.state.summariser
    summariser.quiet = 60
    m = post(client, "lunch at noon?")

    async def fake_ask(path, payload, fallback):
        return {
            "summary": "Lunch at noon.",
            "headline": "Lunch is at **noon**.",
            "topics": [
                {"title": "Lunch", "points": ["noon"], "source_message_ids": [m["id"]]}
            ],
            "decisions": [{"text": "Noon", "source_message_ids": [m["id"]]}],
            "actions": "not a list",
            "questions": [{"text": "Where?", "source_message_ids": [m["id"]]}, "junk"],
        }

    summariser.ask = fake_ask
    with client.websocket_connect("/ws?user=Sam&room=demo") as ws:
        body = client.get("/digest").json()
        event = receive(ws, "summary")
    assert (
        body["summary"] == "Lunch at noon."
        and body["headline"] == "Lunch is at **noon**."
    )
    summary = event["summary"]
    assert summary["trigger"] == "manual" and summary["text"] == "Lunch at noon."
    assert summary["topics"][0]["title"] == "Lunch"
    assert summary["actions"] == [] and len(summary["questions"]) == 1
    assert client.get("/rooms/demo/summary").json()["summary"] == summary


def test_failed_summary_is_not_kept(client):
    summariser, calls = stub_summaries(answer=None)
    summariser.quiet = 0
    post(client, "hello")
    wait_for(lambda: calls)
    time.sleep(0.1)
    assert client.get("/rooms/demo/summary").json() == {"summary": None}


def test_calendar_export(client):
    r = client.get("/calendar.ics?title=Team%20meeting&date=20261010T120000Z")
    assert "BEGIN:VEVENT" in r.text and "SUMMARY:Team meeting" in r.text
    assert client.get("/calendar.ics?date=tomorrow").status_code == 400


def test_migrates_a_scaffold_database(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as db:
        db.executescript(store.MIGRATIONS[0])
        db.execute(
            "INSERT INTO messages(room, user, text, created_at) VALUES ('demo', 'Alex', 'old', '2026-10-09T10:00:00+00:00')"
        )
    monkeypatch.setenv("DB_PATH", str(path))
    store.init()
    store.init()  # idempotent
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == len(store.MIGRATIONS)
    [message] = store.list_messages("demo")
    assert [m["id"] for m in store.search_messages("demo", "old")] == [message["id"]]
    assert (
        message["text"] == "old"
        and message["deleted"] is False
        and message["reply_to"] is None
    )
