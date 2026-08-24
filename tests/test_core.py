from __future__ import annotations

from datetime import date, timedelta

from src.intervals_api import redact_sensitive
from src.coach import generate_plan, reconcile_completed_days
from src.dashboard import calendar_text
from src.metrics import annotate_activities, fatigue_assessment, recent_quality_response, verify_key_workout, weekly_metrics
from src.processing import _normalize_interval, distance_km, seconds_per_km
from src.strava_archive import _matches_intervals, _summary, _unique_headers


def _key_workout():
    intervals = []
    for seconds, pace in ((633, 211), (634, 211.3), (619, 206.3)):
        intervals.append(
            {
                "type": "WORK",
                "distance_km": 3.0,
                "duration_seconds": seconds,
                "pace_seconds_per_km": pace,
            }
        )
    return {
        "id": "i-test",
        "date": "2026-08-12",
        "name": "Track session",
        "description": "",
        "distance_km": 15.0,
        "duration_seconds": 4500,
        "pace_seconds_per_km": 300,
        "elevation_gain_m": 30,
        "training_load": 110,
        "max_hr": 188,
        "race": False,
        "intervals": intervals,
        "sensor_flags": [],
        "manual_feedback": {},
        "stream_intensity_distance_km": None,
    }


def test_redaction_removes_nested_secrets():
    value = {
        "name": "Tobias",
        "icu_api_key": "do-not-store",
        "nested": [{"access_token": "secret", "restingHR": 42}],
    }
    assert redact_sensitive(value) == {"name": "Tobias", "nested": [{"restingHR": 42}]}


def test_distance_and_pace_normalization():
    assert distance_km(10000) == 10
    assert seconds_per_km(10000, 2100) == 210
    assert _normalize_interval({"distance": 122, "moving_time": 36})["distance_km"] == 0.122


def test_strava_duplicate_headers_and_utc_deduplication():
    assert _unique_headers(["Distance", "Elapsed Time", "Elapsed Time", "Distance"]) == [
        "Distance", "Elapsed Time", "Elapsed Time_2", "Distance_2"
    ]
    candidate = _summary(
        {
            "Activity ID": "123",
            "Activity Date": "Sep 7, 2025, 10:19:59 AM",
            "Activity Name": "Travel run",
            "Activity Type": "Run",
            "Distance_2": "15006",
            "Moving Time": "4331",
            "Elapsed Time_2": "4350",
        }
    )
    assert candidate is not None
    # Intervals local time can reflect the travel timezone; UTC is the safe key.
    existing = [{
        "start_date": "2025-09-07T10:19:59Z",
        "start_date_local": "2025-09-07T14:19:59",
        "type": "Run",
        "distance": 15006,
        "moving_time": 4350,
    }]
    assert _matches_intervals(candidate, existing)


def test_key_workout_is_verified_from_intervals():
    workout = _key_workout()
    result = verify_key_workout([workout])
    assert result["status"] == "verified"
    assert result["quality_distance_km"] == 9
    assert result["activity_max_hr"] == 188


def test_weekly_metrics_identify_hm_specific_work():
    rows = annotate_activities([_key_workout()])
    weeks = weekly_metrics(rows)
    assert weeks[0]["distance_km"] == 15.0
    assert weeks[0]["quality_session_count"] == 1
    assert rows[0]["workout_type"] in {"HM-specific", "threshold"}


def test_plan_progression_stays_anchored_when_reanalysis_date_moves(monkeypatch):
    assessment = {
        "as_of_date": "2026-08-13",
        "recent_weeks": [
            {"week_start": "2026-07-27", "week_end": "2026-08-02", "distance_km": 90},
            {"week_start": "2026-08-03", "week_end": "2026-08-09", "distance_km": 92},
        ],
        "fatigue": {"status": "normal/uncertain"},
    }
    initial = generate_plan(assessment, date(2026, 8, 13))
    assessment["as_of_date"] = "2026-08-27"
    updated = generate_plan(assessment, date(2026, 8, 27), existing=initial)
    sep1 = next(day for day in updated["days"] if day["date"] == "2026-09-01")
    assert "3 × 3 km" in sep1["details"]
    sep22 = next(day for day in updated["days"] if day["date"] == "2026-09-22")
    assert "goal HM pace" in sep22["details"]


def test_revised_plan_has_one_rest_day_and_two_major_stimuli_per_full_week():
    assessment = {
        "as_of_date": "2026-08-13",
        "rolling_volume": {"rolling_7_km": 72},
        "recent_weeks": [
            {"week_start": "2026-07-27", "week_end": "2026-08-02", "distance_km": 70},
            {"week_start": "2026-08-03", "week_end": "2026-08-09", "distance_km": 78},
        ],
        "fatigue": {"status": "normal/uncertain"},
    }
    plan = generate_plan(assessment, date(2026, 8, 13))
    days = {item["date"]: item for item in plan["days"]}
    for monday in (date(2026, 8, 17), date(2026, 8, 24), date(2026, 8, 31), date(2026, 9, 7), date(2026, 9, 14), date(2026, 9, 21)):
        week = [days[(monday + timedelta(days=offset)).isoformat()] for offset in range(7)]
        assert sum(item["workout_type"] == "rest" for item in week) == 1
        assert sum(bool(item["major_stimulus"]) for item in week) == 2


def test_reconcile_attaches_actual_without_changing_prescription():
    existing = {
        "days": [{"date": "2026-08-13", "planned_distance_km": 10, "details": "Original workout", "status": "planned"}]
    }
    actual = [{"id": "i1", "date": "2026-08-13", "name": "Actual", "distance_km": 9, "workout_type": "easy", "training_load": 42}]
    result = reconcile_completed_days(existing, actual, date(2026, 8, 13))
    assert result["days"][0]["details"] == "Original workout"
    assert result["days"][0]["status"] == "completed"
    assert result["days"][0]["actual"]["distance_adherence_percent"] == 90


def test_calendar_contains_only_future_planned_sessions():
    plan = {
        "days": [
            {"date": "2026-08-13", "status": "planned", "workout_type": "easy", "planned_distance_km": 10},
            {"date": "2026-08-14", "status": "completed", "workout_type": "easy", "planned_distance_km": 10},
            {
                "date": "2026-08-15", "status": "planned", "workout_type": "threshold", "planned_distance_km": 15,
                "details": "3 × 2 km", "pace_guidance": "controlled", "hr_guidance": "secondary",
                "recovery": "2 min", "terrain_elevation": "flat", "purpose": "threshold", "fatigue_modification": "reduce",
            },
        ]
    }
    text = calendar_text(plan, date(2026, 8, 14))
    assert "DTSTART;VALUE=DATE:20260815" in text
    assert "3 × 2 km" in text
    assert "UID:bad-ischl-2026-08-13@local-running-coach" not in text
    assert "UID:bad-ischl-2026-08-14@local-running-coach" not in text


def test_hiking_load_is_recovery_context_not_running_mileage():
    hike = {
        "date": "2026-08-15", "is_running": False, "type": "Hike", "training_load": 39,
        "duration_seconds": 3 * 3600 + 20 * 60, "elevation_gain_m": 998,
    }
    fatigue = fatigue_assessment([], [], date(2026, 8, 16), [hike])
    assert fatigue["cross_training"]["caution"] == "material"
    assert fatigue["cross_training"]["hiking_ascent_m"] == 998
    assert fatigue["status"] == "normal/uncertain"


def test_fast_finish_high_hr_flags_a_trim_to_next_speed_dose():
    workout = _key_workout()
    workout["date"] = "2026-08-18"
    workout["name"] = "4 x 2 km"
    workout["interval_hr_reps"] = [
        {"distance_km": 2, "pace_seconds_per_km": 210, "average_hr": 168, "max_hr": 182},
        {"distance_km": 2, "pace_seconds_per_km": 210, "average_hr": 179, "max_hr": 187},
        {"distance_km": 2, "pace_seconds_per_km": 206, "average_hr": 179, "max_hr": 184},
        {"distance_km": 2, "pace_seconds_per_km": 202, "average_hr": 185, "max_hr": 192, "end_hr_20s": 189},
    ]
    response = recent_quality_response([workout], date(2026, 8, 18))
    assert response["caution"]
    assert response["work_km"] == 8
