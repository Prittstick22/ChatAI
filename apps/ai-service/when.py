"""Turn the day and time words a model pulled out of a chat message into a datetime.

The model handles the language ("noon", "3pm", "this Saturday"); this module does the
calendar maths, which models get wrong. Anything missing, unclear or already past
resolves to None, so the UI asks a person instead of guessing.
"""

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def parse_time(text: str | None) -> time | None:
    """'12:00', '9:30' or '15' -> time. Anything else -> None."""
    match = re.fullmatch(r"\s*(\d{1,2})(?::(\d{2}))?\s*", text or "")
    if not match:
        return None
    hour, minute = int(match[1]), int(match[2] or 0)
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def _day(word: str, today: date) -> tuple[date, bool] | None:
    """(date, is_weekday_name) for 'today', 'tomorrow', 'saturday' or 'YYYY-MM-DD'."""
    word = re.sub(r"^(this|next|on)\s+", "", word.strip().lower())
    if word in ("today", "tonight"):
        return today, False
    if word == "tomorrow":
        return today + timedelta(days=1), False
    if word in WEEKDAYS:
        ahead = (WEEKDAYS.index(word) - today.weekday()) % 7
        return today + timedelta(days=ahead), True
    try:
        return date.fromisoformat(word), False
    except ValueError:
        return None


def resolve(day: str | None, clock: str | None, said_at: datetime) -> datetime | None:
    """The start time in Europe/London, or None.

    `said_at` is when the message was sent. A weekday means the next one on or after
    that day; if it is today and the time has passed, it means next week."""
    start_time = parse_time(clock)
    if start_time is None or not day:
        return None
    said = said_at.astimezone(LONDON)
    resolved = _day(day, said.date())
    if resolved is None:
        return None
    on, weekday_name = resolved
    start = datetime.combine(on, start_time, tzinfo=LONDON)
    if weekday_name and start <= said:
        start += timedelta(days=7)
    return start if start > said else None
