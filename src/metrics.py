"""Training metrics and cautious multi-signal fitness estimation."""

from __future__ import annotations

import json
import math
import statistics
import csv
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from .config import GOAL_PACE_SECONDS_PER_KM, MANUAL_RACE_RESULTS_PATH, PROCESSED_DIR


WEEKLY_PATH = PROCESSED_DIR / "weekly_metrics.json"
ASSESSMENT_PATH = PROCESSED_DIR / "assessment.json"


def fmt_duration(seconds: float | None) -> str:
    if seconds is None or not math.isfinite(seconds):
        return "unavailable"
    total = max(0, round(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def fmt_pace(seconds: float | None) -> str:
    if seconds is None or not math.isfinite(seconds):
        return "unavailable"
    minutes, secs = divmod(round(seconds), 60)
    return f"{minutes}:{secs:02d}/km"


def _day(value: str) -> date:
    return date.fromisoformat(value[:10])


def _week_start(value: str) -> date:
    day = _day(value)
    return day - timedelta(days=day.weekday())


def _title(activity: dict[str, Any]) -> str:
    return f"{activity.get('name', '')} {activity.get('description', '')}".lower()


def _looks_like_race(activity: dict[str, Any]) -> bool:
    if activity.get("race"):
        return True
    name = str(activity.get("name") or "").lower()
    if any(marker in name for marker in ("wettkampf", "winter series", " race")):
        return True
    training_words = ("pace", "prep", "interval", "tempo", "session", "training", "speedwork")
    return "marathon" in name and not any(word in name for word in training_words)


def interval_quality(activity: dict[str, Any]) -> dict[str, float]:
    bins = {"very_easy": 0.0, "easy": 0.0, "steady": 0.0, "hm_specific": 0.0, "threshold": 0.0, "faster": 0.0}
    stream_bins = activity.get("stream_intensity_distance_km")
    if isinstance(stream_bins, dict) and sum(float(value or 0) for value in stream_bins.values()) > 0:
        return {key: round(float(stream_bins.get(key) or 0), 3) for key in bins}
    intervals = activity.get("intervals") or []
    useful = [
        item for item in intervals
        if (item.get("distance_km") or 0) >= 0.15 and item.get("pace_seconds_per_km")
    ]
    # Some activity details contain multiple overlapping interval sets. Use intervals only
    # when their combined distance plausibly represents one partition of the activity.
    total_interval_km = sum(float(item.get("distance_km") or 0) for item in useful)
    activity_km = float(activity.get("distance_km") or 0)
    if activity_km and total_interval_km > activity_km * 1.25:
        useful = []
    if not useful:
        pace = activity.get("pace_seconds_per_km")
        useful = [{"distance_km": activity.get("distance_km", 0), "pace_seconds_per_km": pace}] if pace else []
    for item in useful:
        km = float(item.get("distance_km") or 0)
        pace = float(item.get("pace_seconds_per_km"))
        if pace >= 285:
            bucket = "very_easy"
        elif pace >= 240:
            bucket = "easy"
        elif pace >= 220:
            bucket = "steady"
        elif pace >= 208:
            bucket = "hm_specific"
        elif pace >= 198:
            bucket = "threshold"
        else:
            bucket = "faster"
        bins[bucket] += km
    return {key: round(value, 3) for key, value in bins.items()}


def classify_workout(activity: dict[str, Any], recent_long_threshold: float = 18.0) -> str:
    title = _title(activity)
    km = float(activity.get("distance_km") or 0)
    bins = interval_quality(activity)
    intervals = activity.get("intervals") or []
    derived_work = activity.get("fast_segments") or []
    explicit_work = [
        item for item in intervals
        if str(item.get("type") or "").upper() in {"WORK", "ACTIVE", "INTERVAL"}
    ]
    candidate_reps = derived_work or explicit_work or intervals
    work_reps = [
        item for item in candidate_reps
        if (item.get("distance_km") or 0) >= 0.15 and (item.get("pace_seconds_per_km") or 999) < 235
    ]
    if _looks_like_race(activity):
        return "race"
    if any(word in title for word in ("recovery", "regeneration", "shakeout")):
        return "recovery"
    if any(word in title for word in ("strength", "kraft", "gym")):
        return "strength/cross-training"
    if len(work_reps) >= 6 and statistics.median(item.get("distance_km", 0) for item in work_reps) <= 1.2:
        median_pace = statistics.median(item.get("pace_seconds_per_km", 999) for item in work_reps)
        return "VO2max" if median_pace < 198 else "short intervals"
    if bins["hm_specific"] >= 4.0:
        return "HM-specific"
    if bins["threshold"] + bins["hm_specific"] >= 4.0 or "threshold" in title or "schwelle" in title:
        return "threshold"
    if bins["faster"] >= 2.0:
        return "10K-specific"
    if km >= recent_long_threshold or "long" in title or "langer lauf" in title:
        return "long run"
    if any(word in title for word in ("progress", "steigerung", "fast finish")):
        return "progression"
    pace = activity.get("pace_seconds_per_km") or 999
    if pace >= 285:
        return "recovery"
    if pace >= 240:
        return "easy"
    return "aerobic steady"


def annotate_activities(activities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    distances = [float(a.get("distance_km") or 0) for a in activities[-112:] if a.get("distance_km")]
    long_threshold = 18.0
    if distances:
        ordered = sorted(distances)
        long_threshold = max(16.0, ordered[min(len(ordered) - 1, int(len(ordered) * 0.88))])
    for activity in activities:
        activity["intensity_distance_km"] = interval_quality(activity)
        activity["workout_type"] = classify_workout(activity, long_threshold)
    return activities


def weekly_metrics(activities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    annotate_activities(activities)
    weeks: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for activity in activities:
        if activity.get("date"):
            weeks[_week_start(activity["date"])].append(activity)
    output: list[dict[str, Any]] = []
    for start, rows in sorted(weeks.items()):
        totals = defaultdict(float)
        for row in rows:
            for key, value in row["intensity_distance_km"].items():
                totals[key] += value
        easy_rows = [row for row in rows if row["workout_type"] in ("easy", "recovery")]
        quality_types = {"threshold", "HM-specific", "10K-specific", "VO2max", "short intervals", "race"}
        quality_rows = [row for row in rows if row["workout_type"] in quality_types]
        total_km = sum(float(row.get("distance_km") or 0) for row in rows)
        duration = sum(float(row.get("duration_seconds") or 0) for row in rows)
        output.append(
            {
                "week_start": start.isoformat(),
                "week_end": (start + timedelta(days=6)).isoformat(),
                "distance_km": round(total_km, 1),
                "duration_hours": round(duration / 3600, 2),
                "elevation_gain_m": round(sum(float(row.get("elevation_gain_m") or 0) for row in rows)),
                "running_days": len({_day(row["date"]) for row in rows}),
                "longest_run_km": round(max((float(row.get("distance_km") or 0) for row in rows), default=0), 1),
                "average_easy_run_km": round(statistics.mean(float(row.get("distance_km") or 0) for row in easy_rows), 1) if easy_rows else 0,
                "quality_session_count": len(quality_rows),
                "quality_session_volume_km": round(sum(sum(row["intensity_distance_km"][key] for key in ("hm_specific", "threshold", "faster")) for row in quality_rows), 1),
                "very_easy_km": round(totals["very_easy"], 1),
                "easy_km": round(totals["easy"], 1),
                "steady_km": round(totals["steady"], 1),
                "hm_specific_km": round(totals["hm_specific"], 1),
                "threshold_km": round(totals["threshold"], 1),
                "faster_than_threshold_km": round(totals["faster"], 1),
                "training_load": round(sum(float(row.get("training_load") or 0) for row in rows), 1),
                "workout_types": [row["workout_type"] for row in rows],
            }
        )
    WEEKLY_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")
    return output


def rolling_volume(activities: list[dict[str, Any]], as_of: date) -> dict[str, float]:
    def total(days: int) -> float:
        cutoff = as_of - timedelta(days=days - 1)
        return sum(
            float(row.get("distance_km") or 0)
            for row in activities
            if row.get("date") and cutoff <= _day(row["date"]) <= as_of
        )
    volume_7 = total(7)
    volume_28 = total(28)
    previous_28 = sum(
        float(row.get("distance_km") or 0)
        for row in activities
        if row.get("date") and as_of - timedelta(days=55) <= _day(row["date"]) <= as_of - timedelta(days=28)
    )
    return {
        "rolling_7_km": round(volume_7, 1),
        "rolling_28_km": round(volume_28, 1),
        "previous_28_km": round(previous_28, 1),
        "seven_day_vs_28_day_weekly_average": round(volume_7 / (volume_28 / 4), 2) if volume_28 else 0,
        "volume_change_28d_percent": round((volume_28 / previous_28 - 1) * 100, 1) if previous_28 else 0,
    }


def verify_key_workout(activities: list[dict[str, Any]]) -> dict[str, Any]:
    target_times = [633, 634, 619]
    candidates: list[tuple[float, dict[str, Any], list[dict[str, Any]]]] = []
    for activity in activities:
        derived = activity.get("fast_segments") or []
        all_intervals = activity.get("intervals", [])
        explicit = [item for item in all_intervals if str(item.get("type") or "").upper() in {"WORK", "ACTIVE", "INTERVAL"}]
        reps = [
            item for item in (derived or explicit or all_intervals)
            if 2.7 <= float(item.get("distance_km") or 0) <= 3.3
            and 195 <= float(item.get("pace_seconds_per_km") or 999) <= 220
        ]
        if len(reps) >= 3:
            for index in range(len(reps) - 2):
                group = reps[index:index + 3]
                score = sum(abs(float(rep.get("duration_seconds") or 0) - target) for rep, target in zip(group, target_times))
                candidates.append((score, activity, group))
    if not candidates:
        return {
            "status": "not found",
            "evidence": "No cached activity contains three approximately 3 km work intervals matching the supplied session.",
            "limitations": "The activity may not be synchronized yet, or manual/automatic intervals may differ.",
        }
    score, activity, reps = min(candidates, key=lambda item: item[0])
    rep_times = [float(rep.get("duration_seconds") or 0) for rep in reps]
    total_distance = sum(float(rep.get("distance_km") or 0) for rep in reps)
    total_time = sum(rep_times)
    close_match = score <= 45 and 8.4 <= total_distance <= 9.6
    recoveries = [
        float(next_rep.get("start_time") or 0) - float(rep.get("end_time") or 0)
        for rep, next_rep in zip(reps, reps[1:])
        if rep.get("end_time") is not None and next_rep.get("start_time") is not None
    ]
    return {
        "status": "verified" if close_match else "possible match",
        "activity_id": activity.get("id"),
        "date": activity.get("date"),
        "name": activity.get("name"),
        "rep_times": [fmt_duration(value) for value in rep_times],
        "rep_paces": [fmt_pace(rep.get("pace_seconds_per_km")) for rep in reps],
        "quality_distance_km": round(total_distance, 2),
        "quality_time": fmt_duration(total_time),
        "average_quality_pace": fmt_pace(total_time / total_distance if total_distance else None),
        "recoveries": [fmt_duration(value) for value in recoveries],
        "activity_max_hr": activity.get("max_hr"),
        "sensor_flags": activity.get("sensor_flags") or [],
        "evidence": "Lap/interval data were used; title alone was not used for verification.",
        "limitations": "Wind and subjective control are not inferable from streams unless recorded in notes/manual feedback.",
    }


def _race_signals(activities: list[dict[str, Any]], as_of: date) -> list[dict[str, Any]]:
    signals = []
    manual_dates: set[str] = set()
    if MANUAL_RACE_RESULTS_PATH.exists():
        with MANUAL_RACE_RESULTS_PATH.open(encoding="utf-8-sig", newline="") as handle:
            manual_dates = {str(row.get("date") or "") for row in csv.DictReader(handle) if row.get("date")}
    for activity in activities:
        if not activity.get("date") or (as_of - _day(activity["date"])).days > 365:
            continue
        if activity["date"] in manual_dates:
            # Official/manual race results override GPS distance and device time
            # for the same day; the activity remains available for HR/splits.
            continue
        if not _looks_like_race(activity):
            continue
        distance = float(activity.get("distance_km") or 0)
        duration = float(activity.get("duration_seconds") or 0)
        if 3.0 <= distance <= 50 and duration > 600:
            hm_equivalent = duration * (21.0975 / distance) ** 1.06
            age_days = max(0, (as_of - _day(activity["date"])).days)
            signals.append({"source": f"race {activity['date']} ({distance:.1f} km)", "hm_seconds": hm_equivalent, "age_days": age_days})
    if MANUAL_RACE_RESULTS_PATH.exists():
        with MANUAL_RACE_RESULTS_PATH.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                try:
                    race_date = _day(row["date"])
                    distance = float(row["distance_km"])
                    parts = [int(part) for part in row["time"].split(":")]
                    if len(parts) == 3:
                        duration = parts[0] * 3600 + parts[1] * 60 + parts[2]
                    elif len(parts) == 2:
                        duration = parts[0] * 60 + parts[1]
                    else:
                        continue
                except (KeyError, TypeError, ValueError):
                    continue
                if not (3.0 <= distance <= 50 and duration > 600 and 0 <= (as_of - race_date).days <= 365):
                    continue
                hm_equivalent = duration * (21.0975 / distance) ** 1.06
                qualifier = "official" if str(row.get("official", "")).lower() in {"true", "yes", "1"} else "manual"
                signals.append(
                    {
                        "source": f"{qualifier} race {row['date']} — {row.get('race') or 'race'} ({distance:.1f} km in {fmt_duration(duration)})",
                        "hm_seconds": hm_equivalent,
                        "age_days": max(0, (as_of - race_date).days),
                        "distance_km": distance,
                        "duration_seconds": duration,
                        "official": qualifier == "official",
                    }
                )
    return signals


def _workout_signals(activities: list[dict[str, Any]], as_of: date) -> list[dict[str, Any]]:
    signals = []
    for activity in activities:
        if not activity.get("date") or (as_of - _day(activity["date"])).days > 120:
            continue
        derived = activity.get("fast_segments") or []
        all_intervals = activity.get("intervals", [])
        explicit = [item for item in all_intervals if str(item.get("type") or "").upper() in {"WORK", "ACTIVE", "INTERVAL"}]
        work = [
            item for item in (derived or explicit or all_intervals)
            if float(item.get("distance_km") or 0) >= 1.5
            and 195 <= float(item.get("pace_seconds_per_km") or 999) <= 225
        ]
        distance = sum(float(item.get("distance_km") or 0) for item in work)
        duration = sum(float(item.get("duration_seconds") or 0) for item in work)
        if distance >= 6 and duration > 0:
            work_pace = duration / distance
            # Broken work normally overstates sustainable HM pace; penalty narrows as volume rises.
            penalty = max(3.0, 10.0 - min(distance, 14.0) * 0.45)
            signals.append(
                {
                    "source": f"specific/threshold session {activity['date']} ({distance:.1f} km work)",
                    "hm_seconds": (work_pace + penalty) * 21.0975,
                    "work_pace": work_pace,
                    "distance": distance,
                    "age_days": max(0, (as_of - _day(activity["date"])).days),
                }
            )
    return signals


def _short_distance_signals(activities: list[dict[str, Any]], as_of: date) -> dict[str, list[dict[str, Any]]]:
    """Independent shorter-distance markers from continuous and short-rep work."""
    five_k: list[dict[str, Any]] = []
    ten_k: list[dict[str, Any]] = []
    for activity in activities:
        if not activity.get("date") or (as_of - _day(activity["date"])).days > 120:
            continue
        distance = float(activity.get("distance_km") or 0)
        duration = float(activity.get("duration_seconds") or 0)
        intensity = float(activity.get("intensity") or 0)
        avg_hr = float(activity.get("average_hr") or 0)
        if 4.5 <= distance <= 7.0 and duration > 0 and intensity >= 95 and avg_hr >= 165:
            five_equivalent = duration * (5.0 / distance) ** 1.06
            five_k.append(
                {
                    "source": f"hard continuous effort {activity['date']} ({distance:.2f} km; not assumed to be a race)",
                    "seconds": five_equivalent,
                }
            )
        reps = [
            segment for segment in (activity.get("fast_segments") or [])
            if 0.75 <= float(segment.get("distance_km") or 0) <= 1.3
        ]
        rep_distance = sum(float(item.get("distance_km") or 0) for item in reps)
        rep_time = sum(float(item.get("duration_seconds") or 0) for item in reps)
        if rep_distance >= 6 and rep_time > 0:
            rep_pace = rep_time / rep_distance
            ten_k.append(
                {
                    "source": f"short-interval session {activity['date']} ({rep_distance:.1f} km work)",
                    "seconds": (rep_pace + 4.0) * 10,
                }
            )
    return {"5k": five_k, "10k": ten_k}


def _range(center: float, spread: float) -> list[float]:
    return [round(center - spread), round(center + spread)]


def _weighted_median(values: list[tuple[float, float]]) -> float:
    ordered = sorted(values, key=lambda item: item[0])
    threshold = sum(weight for _, weight in ordered) / 2
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= threshold:
            return value
    return ordered[-1][0]


def estimate_fitness(activities: list[dict[str, Any]], weeks: list[dict[str, Any]], as_of: date) -> dict[str, Any]:
    races = _race_signals(activities, as_of)
    workouts = _workout_signals(activities, as_of)
    short = _short_distance_signals(activities, as_of)
    all_signals = races + workouts
    # Current fitness is driven by the most recent 90 days. Older races remain
    # valuable historical context but must not dominate present readiness.
    current_signals = [signal for signal in all_signals if float(signal.get("age_days") or 0) <= 90] or all_signals
    candidates = [signal["hm_seconds"] for signal in current_signals]
    recent_weeks = [week for week in weeks if _day(week["week_start"]) >= as_of - timedelta(weeks=8)]
    complete_recent = [week for week in recent_weeks if _day(week["week_end"]) <= as_of]
    avg_volume = statistics.mean(week["distance_km"] for week in complete_recent) if complete_recent else 0
    consistency = sum(week["running_days"] >= 4 for week in complete_recent) / len(complete_recent) if complete_recent else 0
    if not candidates:
        unavailable = {
            "likely_range": "unavailable",
            "confidence": "low",
            "supporting_evidence": ["No recent race or sufficiently detailed sustained-workout signal is cached."],
            "evidence_against": ["Current fitness must not be inferred from historical PBs alone."],
        }
        return {
            "5k": unavailable, "10k": unavailable, "half_marathon": unavailable,
            "goal_feasibility": {"rating": "unknown", "confidence": "low", "reason": "Insufficient synchronized performance evidence."},
            "signals": [], "average_recent_weekly_km": round(avg_volume, 1), "consistency": round(consistency, 2),
        }
    weighted_candidates: list[tuple[float, float]] = []
    for signal in current_signals:
        age_days = float(signal.get("age_days") or 0)
        recency_weight = 0.5 ** (age_days / 120.0)
        distance = float(signal.get("distance_km") or signal.get("distance") or 0)
        if signal.get("official") and 20 <= distance <= 22:
            evidence_weight = 1.4
        elif signal.get("official"):
            evidence_weight = 1.15
        else:
            evidence_weight = 1.0
        weighted_candidates.append((float(signal["hm_seconds"]), recency_weight * evidence_weight))
    center = _weighted_median(weighted_candidates)
    disagreement = statistics.pstdev(candidates) if len(candidates) > 1 else 75
    spread = max(45, min(180, disagreement + (30 if len(candidates) < 3 else 0)))
    recent_races = [signal for signal in races if float(signal.get("age_days") or 0) <= 90]
    recent_workouts = [signal for signal in workouts if float(signal.get("age_days") or 0) <= 90]
    confidence = "high" if len(recent_races) >= 1 and len(recent_workouts) >= 2 and disagreement < 90 else "moderate" if len(candidates) >= 2 else "low"
    hm_range = _range(center, spread)
    # Derive shorter estimates from the multi-signal HM estimate, not as independent proof.
    ten_center = center * (10 / 21.0975) ** 1.06
    five_center = center * (5 / 21.0975) ** 1.06
    support = [signal["source"] for signal in current_signals[-6:]]
    historical_hm = [
        signal for signal in races
        if 20 <= float(signal.get("distance_km") or 0) <= 22 and float(signal.get("age_days") or 0) > 90
    ]
    if historical_hm:
        support.append(f"historical context: {historical_hm[-1]['source']}")
    against = []
    if avg_volume < 70:
        against.append(f"Recent complete-week volume averages {avg_volume:.1f} km, which may limit HM durability.")
    if consistency < 0.75:
        against.append("Fewer than 75% of recent complete weeks contain at least four running days.")
    if len(recent_races) == 0:
        against.append("No recent race result is available to validate workout-based estimates.")
    if not against:
        against.append("Race-day durability, weather, course, and taper response remain uncertain.")
    upper = hm_range[1]
    lower = hm_range[0]
    # Goal feasibility considers the current range and the remaining training window.
    # A goal just outside today's range is not automatically "low" with 6+ weeks left.
    days_to_race = max(0, (date(2026, 9, 27) - as_of).days)
    development_margin = min(75.0, days_to_race * 1.25)
    # This is a conditional forecast, not today's ability: modest specific
    # development plus taper, with no assumption that every week goes perfectly.
    projected_lower = max(0.0, lower - min(30.0, days_to_race * 0.67))
    projected_upper = max(projected_lower, upper - min(57.0, days_to_race * 1.27))
    if upper <= 4500:
        feasibility = "high"
    elif lower <= 4500 or lower - development_margin <= 4500:
        feasibility = "moderate"
    else:
        feasibility = "low"
    official_five = [
        signal for signal in races
        if signal.get("official") and 4.8 <= float(signal.get("distance_km") or 0) <= 5.2
    ]
    if official_five:
        latest_five = min(official_five, key=lambda item: item.get("age_days", 9999))
        result = float(latest_five["duration_seconds"])
        # A recent official result is a hard anchor. The narrow range allows normal
        # day-to-day variation and modest development without pretending a new PB.
        five_range = f"{fmt_duration(result - 8)}–{fmt_duration(result + 17)}"
        five_confidence = "high"
        five_support = [latest_five["source"]]
        five_against = ["No more recent all-out 5K has tested whether fitness has changed since race day."]
    elif short["5k"]:
        best_five = min(signal["seconds"] for signal in short["5k"])
        five_range = f"{fmt_duration(best_five - 15)}–{fmt_duration(best_five + 30)}"
        five_confidence = "moderate"
        five_support = [signal["source"] for signal in short["5k"]]
        five_against = ["The strongest continuous marker is not labelled as a race, so maximal effort and course accuracy are uncertain."]
    else:
        five_range = f"{fmt_duration(five_center - spread * 0.35)}–{fmt_duration(five_center + spread * 0.35)}"
        five_confidence = confidence
        five_support = support
        five_against = ["This shorter-distance range is derived from HM-level signals; it is not a recent 5K test."]
    if short["10k"]:
        ten_values = [signal["seconds"] for signal in short["10k"]]
        ten_marker = min(ten_values)
        ten_range = f"{fmt_duration(ten_marker - 20)}–{fmt_duration(ten_marker + 35)}"
        ten_confidence = "moderate"
        ten_support = [signal["source"] for signal in short["10k"]]
        ten_against = ["The range comes from repeat work with recovery, not a continuous 10K race."]
    else:
        ten_range = f"{fmt_duration(ten_center - spread * 0.58)}–{fmt_duration(ten_center + spread * 0.58)}"
        ten_confidence = confidence
        ten_support = support
        ten_against = ["Speed reserve is uncertain without a recent 10K race or comparable session."]
    return {
        "5k": {
            "likely_range": five_range,
            "confidence": five_confidence,
            "supporting_evidence": five_support,
            "evidence_against": five_against,
        },
        "10k": {
            "likely_range": ten_range,
            "confidence": ten_confidence,
            "supporting_evidence": ten_support,
            "evidence_against": ten_against,
        },
        "half_marathon": {
            "likely_range": f"{fmt_duration(lower)}–{fmt_duration(upper)}",
            "confidence": confidence,
            "supporting_evidence": support,
            "evidence_against": against,
        },
        "goal_feasibility": {
            "rating": feasibility,
            "confidence": confidence,
            "reason": f"Today's multi-signal HM range is {fmt_duration(lower)}–{fmt_duration(upper)} versus the 1:15:00 target.",
            "current_range": f"{fmt_duration(lower)}–{fmt_duration(upper)}",
            "conditional_race_day_range": f"{fmt_duration(projected_lower)}–{fmt_duration(projected_upper)}",
            "forecast_assumptions": "Healthy completion of the specific block, normal recovery, a competent taper, and reasonable race conditions.",
        },
        "signals": races + workouts,
        "average_recent_weekly_km": round(avg_volume, 1),
        "consistency": round(consistency, 2),
    }


def fatigue_assessment(
    activities: list[dict[str, Any]], wellness: list[dict[str, Any]], as_of: date, all_activities: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    recent = [row for row in activities if row.get("date") and as_of - timedelta(days=7) <= _day(row["date"]) <= as_of]
    warnings: list[str] = []
    positives: list[str] = []
    feedback = [row.get("manual_feedback") or {} for row in recent]
    fatigue_values = [float(row["fatigue_1_10"]) for row in feedback if str(row.get("fatigue_1_10", "")).strip()]
    sleep_values = [float(row["sleep_1_10"]) for row in feedback if str(row.get("sleep_1_10", "")).strip()]
    pain = [str(row.get("pain", "")).strip() for row in feedback if str(row.get("pain", "")).strip()]
    if fatigue_values and statistics.mean(fatigue_values) >= 7:
        warnings.append("Manual fatigue averages at least 7/10 over recent entries.")
    if sleep_values and statistics.mean(sleep_values) <= 4:
        warnings.append("Manual sleep quality averages 4/10 or lower.")
    if pain:
        warnings.append("Recent manual feedback contains a pain entry; intensity should be held pending clarification.")
    recent_wellness = [row for row in wellness if row.get("id") and as_of - timedelta(days=7) <= _day(row["id"]) <= as_of]
    subjective = [float(row["fatigue"]) for row in recent_wellness if row.get("fatigue") is not None]
    soreness = [float(row["soreness"]) for row in recent_wellness if row.get("soreness") is not None]
    if subjective and statistics.mean(subjective) >= 3:
        warnings.append("Intervals.icu wellness fatigue is elevated (1–4 scale, higher is worse).")
    if soreness and statistics.mean(soreness) >= 3:
        warnings.append("Intervals.icu wellness soreness is elevated (1–4 scale, higher is worse).")
    sensor_flags = [flag for row in recent for flag in row.get("sensor_flags", [])]
    if sensor_flags:
        warnings.append("At least one recent HR trace has an anomaly flag; HR-based conclusions are down-weighted.")
    all_activities = all_activities if all_activities is not None else activities
    cross_recent = [
        row for row in all_activities
        if row.get("date") and as_of - timedelta(days=7) <= _day(row["date"]) <= as_of and not row.get("is_running")
    ]
    cross_load = sum(float(row.get("training_load") or 0) for row in cross_recent)
    cross_hours = sum(float(row.get("duration_seconds") or 0) for row in cross_recent) / 3600
    hike_rows = [row for row in cross_recent if str(row.get("type") or "").replace(" ", "").lower() in {"hike", "walk"}]
    hike_ascent = sum(float(row.get("elevation_gain_m") or 0) for row in hike_rows)
    cross_types = sorted({str(row.get("type") or "Other") for row in cross_recent})
    # Intervals load is useful context across sports, but it is not treated as
    # equivalent running mileage. Hiking ascent also flags eccentric leg stress.
    if cross_load >= 100 or hike_ascent >= 1400 or cross_hours >= 6:
        cross_caution = "high"
        warnings.append(
            f"Recent non-running training is high ({cross_load:.0f} load, {cross_hours:.1f} h, {hike_ascent:.0f} m hiking ascent); reduce the next running stimulus."
        )
    elif cross_load >= 45 or hike_ascent >= 700 or cross_hours >= 3:
        cross_caution = "material"
        positives.append(
            f"Recent non-running work is material ({cross_load:.0f} load, {cross_hours:.1f} h, {hike_ascent:.0f} m hiking ascent) and is being counted as recovery context, not running km."
        )
    else:
        cross_caution = "low"
    if not warnings:
        positives.append("No strong fatigue warning is present in the available recent wellness/manual fields.")
    missing = []
    for field in ("restingHR", "hrv", "sleepSecs", "fatigue", "soreness"):
        if not any(row.get(field) is not None for row in recent_wellness):
            missing.append(field)
    return {
        "status": "elevated" if warnings else "normal/uncertain",
        "warnings": warnings,
        "positive_signals": positives,
        "missing_recent_wellness_fields": missing,
        "cross_training": {
            "sessions": len(cross_recent),
            "types": cross_types,
            "training_load": round(cross_load, 1),
            "duration_hours": round(cross_hours, 1),
            "hiking_ascent_m": round(hike_ascent),
            "caution": cross_caution,
        },
        "physiological_test_data": "No lactate/physiological test is assumed unless an actual test or lactate field is present in synchronized data.",
    }


def coach_review(weeks: list[dict[str, Any]], fatigue: dict[str, Any], as_of: date) -> dict[str, Any]:
    """Turn weekly training evidence into a conservative coaching decision."""
    completed = [week for week in weeks if date.fromisoformat(week["week_end"]) <= as_of]
    if not completed:
        return {"rating": "insufficient evidence", "summary": "No complete week is available yet.", "decision": "Keep the plan conservative until a complete week is synchronized.", "evidence": []}
    latest = completed[-1]
    prior = completed[-5:-1]
    baseline = statistics.mean(week["distance_km"] for week in prior) if prior else latest["distance_km"]
    ratio = latest["distance_km"] / baseline if baseline else 0
    quality = int(latest.get("quality_session_count") or 0)
    long_run = float(latest.get("longest_run_km") or 0)
    cross = fatigue.get("cross_training", {})
    evidence = [
        f"{latest['distance_km']:.1f} km running ({ratio:.0%} of the preceding four-week mean).",
        f"{quality} major quality session(s); longest run {long_run:.1f} km.",
    ]
    if cross.get("sessions"):
        evidence.append(f"Non-running context: {cross.get('sessions')} session(s), {cross.get('training_load', 0):g} load, {cross.get('hiking_ascent_m', 0):g} m hiking ascent.")
    if fatigue.get("status") == "elevated" or cross.get("caution") == "high":
        return {"rating": "reduce", "summary": "Recovery/load signals outweigh the benefit of adding work this week.", "decision": "Keep the rest day, reduce the next quality session to its stated fallback, and do not replace missed kilometres.", "evidence": evidence}
    if quality >= 1 and long_run >= 18 and ratio >= 0.82:
        return {"rating": "progressing", "summary": "The weekly structure supports HM progress without a clear recovery warning.", "decision": "Keep the next planned quality session controlled; progress by completing it well, not by running faster.", "evidence": evidence}
    return {"rating": "consolidate", "summary": "The week is useful training, but the evidence does not justify adding load yet.", "decision": "Keep intensity controlled and prioritise completing the planned easy/long-run structure before progressing quality volume.", "evidence": evidence}


def recent_quality_response(activities: list[dict[str, Any]], as_of: date) -> dict[str, Any]:
    """Flag only a clear fast-finish/high-HR response, not normal workout progression."""
    candidates = [
        row for row in activities
        if row.get("date") and as_of - timedelta(days=2) <= _day(row["date"]) <= as_of
        and len(row.get("interval_hr_reps") or []) >= 3
    ]
    if not candidates:
        return {"caution": False, "summary": "No recent interval response is available."}
    row = max(candidates, key=lambda item: item.get("date", ""))
    reps = row.get("interval_hr_reps") or []
    paces = [float(rep.get("pace_seconds_per_km")) for rep in reps if rep.get("pace_seconds_per_km")]
    average_hr = [float(rep.get("average_hr")) for rep in reps if rep.get("average_hr")]
    recovery_drops = [float(rep.get("recovery_hr_drop")) for rep in reps if rep.get("recovery_hr_drop") is not None]
    end_hr = [float(rep.get("end_hr_20s")) for rep in reps if rep.get("end_hr_20s")]
    max_hr = max((float(rep.get("max_hr") or 0) for rep in reps), default=0)
    work_km = sum(float(rep.get("distance_km") or 0) for rep in reps)
    fast_finish = len(paces) >= 4 and paces[-1] <= min(paces[:-1]) - 3
    # Do not let a one- or two-second chest-strap spike overrule sustained HR.
    sustained_finish_hr = (end_hr[-1] if end_hr else 0) >= 188 or (average_hr[-1] if average_hr else 0) >= 184
    high_finish = max_hr >= 190 and sustained_finish_hr
    caution = bool(fast_finish and high_finish)
    return {
        "caution": caution,
        "date": row.get("date"),
        "activity_name": row.get("name"),
        "work_km": round(work_km, 1),
        "rep_paces_seconds_per_km": [round(value, 1) for value in paces],
        "rep_average_hr": [round(value, 1) for value in average_hr],
        "recovery_hr_drops": [round(value, 1) for value in recovery_drops],
        "rep_max_hr": round(max_hr),
        "final_rep_end_hr_20s": round(end_hr[-1], 1) if end_hr else None,
        "summary": (
            "The last repetition was materially faster than the preceding reps and HR reached a high peak; retain the next recovery days and trim the following speed dose."
            if caution else "Recent repetition pacing/HR does not show a clear overreach flag; interpret pace variation with wind, grade and perceived effort."
        ),
    }


def build_assessment(
    activities: list[dict[str, Any]], wellness: list[dict[str, Any]], as_of: date, all_activities: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    weeks = weekly_metrics(activities)
    fatigue = fatigue_assessment(activities, wellness, as_of, all_activities)
    assessment = {
        "as_of_date": as_of.isoformat(),
        "rolling_volume": rolling_volume(activities, as_of),
        "fitness": estimate_fitness(activities, weeks, as_of),
        "fatigue": fatigue,
        "coach_review": coach_review(weeks, fatigue, as_of),
        "recent_quality_response": recent_quality_response(activities, as_of),
        "key_workout": verify_key_workout(activities),
        "recent_weeks": weeks[-16:],
    }
    ASSESSMENT_PATH.write_text(json.dumps(assessment, indent=2, ensure_ascii=False), encoding="utf-8")
    return assessment
