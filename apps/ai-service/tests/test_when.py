from datetime import datetime

import pytest

from when import LONDON, parse_time, resolve


def said(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=LONDON)


@pytest.mark.parametrize(
    "day, time, at, expected",
    [
        ("saturday", "12:00", "2026-10-09 18:00", "2026-10-10T12:00:00+01:00"),
        ("saturday", "12:00", "2026-10-10 09:45", "2026-10-10T12:00:00+01:00"),
        ("saturday", "12:00", "2026-10-10 14:00", "2026-10-17T12:00:00+01:00"),
        ("Next Saturday", "15:30", "2026-10-08 10:00", "2026-10-10T15:30:00+01:00"),
        ("tomorrow", "9:00", "2026-10-10 22:00", "2026-10-11T09:00:00+01:00"),
        ("today", "18:00", "2026-10-10 09:45", "2026-10-10T18:00:00+01:00"),
        ("2026-10-24", "12:00", "2026-10-10 09:45", "2026-10-24T12:00:00+01:00"),
        # Clocks go back on Sunday 25 October 2026: noon that day is GMT.
        ("sunday", "12:00", "2026-10-24 12:00", "2026-10-25T12:00:00+00:00"),
    ],
)
def test_resolves_day_and_time_in_london(day, time, at, expected):
    assert resolve(day, time, said(at)).isoformat() == expected


@pytest.mark.parametrize(
    "day, time",
    [
        ("saturday", None),  # no clock time
        (None, "12:00"),  # no day
        ("someday", "12:00"),
        ("today", "08:00"),  # already past
        ("2026-10-01", "12:00"),
        ("saturday", "noon"),  # the model is asked for HH:MM
        ("saturday", "25:00"),
    ],
)
def test_anything_unclear_or_past_is_none(day, time):
    assert resolve(day, time, said("2026-10-10 09:45")) is None


def test_parse_time():
    assert parse_time("9:30").isoformat() == "09:30:00"
    assert parse_time("15").isoformat() == "15:00:00"
    assert parse_time("12:60") is None
