"""Run against a started ChatAI stack: python scripts/smoke_test.py"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CHAT = os.getenv("CHAT_API_URL", "http://localhost:8000")
AI = os.getenv("AI_API_URL", "http://localhost:8001")
ROOM = "smoke_" + str(int(time.time()))

def request(url, payload=None, method=None):
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method=method), timeout=18) as response:
        content = response.read().decode()
        return json.loads(content) if "json" in response.headers.get("Content-Type", "") else content

def test(label, fn):
    try:
        fn()
        print("[PASS]", label)
        return True
    except Exception as exc:
        print("[FAIL]", label, "-", repr(exc))
        return False

def health(base):
    assert request(base + "/health")["status"] == "ok"

def messages():
    posted = request(CHAT + "/messages", {"room": ROOM, "user": "SmokeTest", "text": "Meeting at noon tomorrow"})
    assert posted["id"] > 0
    room = request(CHAT + "/messages?room=" + urllib.parse.quote(ROOM))
    assert any(m["id"] == posted["id"] for m in room)

def intelligence():
    assert isinstance(request(CHAT + "/digest")["summary"], str)
    assert isinstance(request(CHAT + "/search?query=meeting")["results"], list)
    assert isinstance(request(CHAT + "/suggest")["suggestion"], str)

def polls():
    p = request(CHAT + "/polls", {"question": "Pick a day", "options": ["Saturday", "Sunday"]}, method="POST")
    assert p["id"] > 0
    assert request(CHAT + "/polls/" + str(p["id"]) + "/votes", {"user": "SmokeTest", "option_index": 0})["ok"]

def calendar():
    with urllib.request.urlopen(CHAT + "/calendar.ics?title=Team%20meeting&date=20261010T120000Z", timeout=8) as response:
        text = response.read().decode()
        assert "BEGIN:VCALENDAR" in text and "BEGIN:VEVENT" in text

if __name__ == "__main__":
    outcomes = [
        test("chat health", lambda: health(CHAT)),
        test("AI health", lambda: health(AI)),
        test("message storage", messages),
        test("AI digest/search/suggestion endpoints", intelligence),
        test("poll and vote", polls),
        test("ICS calendar export", calendar),
    ]
    print(f"\n{sum(outcomes)}/{len(outcomes)} checks passed")
    sys.exit(0 if all(outcomes) else 1)
