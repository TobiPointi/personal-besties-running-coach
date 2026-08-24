"""Normalize cached Intervals.icu data without discarding original fields."""

from __future__ import annotations

import csv
import json
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .config import MANUAL_FEEDBACK_PATH, PROCESSED_DIR, RAW_DIR
from .sync import DETAIL_DIR, MESSAGE_DIR, RUN_TYPES, STREAM_DIR
from .strava_archive import STRAVA_ACTIVITIES_PATH, STRAVA_STREAM_DIR


PROCESSED_ACTIVITIES_PATH = PROCESSED_DIR / "running_activities.json"
PROCESSED_ACTIVITIES_CSV = PROCESSED_DIR / "running_activities.csv"
PROCESSED_ALL_ACTIVITIES_PATH = PROCESSED_DIR / "all_activities.json"
PROCESSED_ALL_ACTIVITIES_CSV = PROCESSED_DIR / "all_activities.csv"
PROCESSED_WELLNESS_PATH = PROCESSED_DIR / "wellness.json"
PROCESSING_QUALITY_PATH = PROCESSED_DIR / "processing_quality.json"


def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _is_run(activity: dict[str, Any]) -> bool:
    value = str(activity.get("type") or "").replace(" ", "").lower()
    return value in RUN_TYPES or value.endswith("run")


def _number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def distance_km(value: Any) -> float:
    distance = _number(value) or 0.0
    # Intervals.icu activity/interval distance is metres. The fallback also tolerates fixtures in km.
    return distance / 1000.0 if distance > 200 else distance


def seconds_per_km(distance: Any, duration: Any, speed: Any = None) -> float | None:
    km = distance_km(distance)
    seconds = _number(duration)
    if km > 0 and seconds and seconds > 0:
        return seconds / km
    metres_per_second = _number(speed)
    if metres_per_second and metres_per_second > 0:
        return 1000.0 / metres_per_second
    return None


def _read_feedback() -> dict[str, dict[str, str]]:
    if not MANUAL_FEEDBACK_PATH.exists():
        return {}
    rows: dict[str, dict[str, str]] = {}
    with MANUAL_FEEDBACK_PATH.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            key = (row.get("activity_id") or row.get("date") or "").strip()
            if key:
                rows[key] = row
    return rows


def _stream_map(activity_id: str) -> dict[str, list[Any]]:
    streams = _load(STREAM_DIR / f"{activity_id}.json", [])
    if not streams:
        streams = _load(STRAVA_STREAM_DIR / f"{activity_id}.json", [])
    result: dict[str, list[Any]] = {}
    for stream in streams:
        data = stream.get("data")
        if isinstance(data, list):
            result[str(stream.get("type", "")).lower()] = data
    return result


def _stream_intensity_distance(streams: dict[str, list[Any]]) -> dict[str, float] | None:
    """Estimate distance by pace band from point streams, avoiding time-sampling bias."""
    distances = streams.get("distance")
    speeds = streams.get("velocity_smooth") or streams.get("speed")
    if not distances or not speeds or len(distances) != len(speeds):
        return None
    bins = {"very_easy": 0.0, "easy": 0.0, "steady": 0.0, "hm_specific": 0.0, "threshold": 0.0, "faster": 0.0}
    valid_segments = 0
    for previous, current, speed in zip(distances, distances[1:], speeds[1:]):
        previous_value, current_value, speed_value = _number(previous), _number(current), _number(speed)
        if previous_value is None or current_value is None or speed_value is None or speed_value <= 0:
            continue
        delta_km = (current_value - previous_value) / 1000.0
        if delta_km <= 0 or delta_km > 0.2:
            continue
        pace = 1000.0 / speed_value
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
        bins[bucket] += delta_km
        valid_segments += 1
    return {key: round(value, 3) for key, value in bins.items()} if valid_segments >= 30 else None


def _derive_fast_segments(streams: dict[str, list[Any]]) -> list[dict[str, float]]:
    """Recover sustained fast blocks when API interval collections overlap.

    Intervals.icu can return automatic intervals, manual laps, kilometre laps and
    aggregate intervals in one overlapping collection. Speed streams form a
    single timeline, so these derived blocks are safer for repetition structure.
    """
    times = streams.get("time")
    distances = streams.get("distance")
    speeds = streams.get("velocity_smooth") or streams.get("speed")
    if not times or not distances or not speeds or not (len(times) == len(distances) == len(speeds)):
        return []
    threshold_mps = 4.15  # 4:01/km; intended to isolate sustained quality blocks.
    allowed_gap_seconds = 12.0
    segments: list[dict[str, float]] = []
    start: int | None = None
    last_fast: int | None = None
    for index, raw_speed in enumerate(speeds):
        speed = _number(raw_speed)
        current_time = _number(times[index])
        if speed is None or current_time is None:
            continue
        if speed >= threshold_mps:
            if start is None:
                start = index
            last_fast = index
        end_of_stream = index == len(speeds) - 1
        gap_exceeded = (
            start is not None
            and last_fast is not None
            and current_time - float(_number(times[last_fast]) or current_time) > allowed_gap_seconds
        )
        if start is not None and last_fast is not None and (gap_exceeded or end_of_stream):
            start_time = _number(times[start])
            end_time = _number(times[last_fast])
            start_distance = _number(distances[start])
            end_distance = _number(distances[last_fast])
            if None not in (start_time, end_time, start_distance, end_distance):
                duration = float(end_time) - float(start_time)
                km = (float(end_distance) - float(start_distance)) / 1000.0
                if duration >= 120 and km >= 0.5:
                    segments.append(
                        {
                            "start_index": start,
                            "end_index": last_fast,
                            "start_time": round(float(start_time), 1),
                            "end_time": round(float(end_time), 1),
                            "duration_seconds": round(duration, 1),
                            "distance_km": round(km, 4),
                            "pace_seconds_per_km": round(duration / km, 2),
                        }
                    )
            start = None
            last_fast = None
    return segments


def _estimate_hr_pace_drift(streams: dict[str, list[Any]]) -> float | None:
    """Estimate first/second-half speed-per-HR drift on moving samples."""
    speeds = streams.get("velocity_smooth") or streams.get("speed")
    heart_rates = streams.get("heartrate")
    if not speeds or not heart_rates or len(speeds) != len(heart_rates):
        return None
    samples: list[tuple[float, float]] = []
    for raw_speed, raw_hr in zip(speeds, heart_rates):
        speed, hr = _number(raw_speed), _number(raw_hr)
        if speed is not None and hr is not None and speed >= 2.5 and 60 <= hr <= 220:
            samples.append((speed, hr))
    if len(samples) < 600:
        return None
    midpoint = len(samples) // 2
    halves = (samples[:midpoint], samples[midpoint:])
    efficiency = []
    for half in halves:
        mean_speed = sum(item[0] for item in half) / len(half)
        mean_hr = sum(item[1] for item in half) / len(half)
        efficiency.append(mean_speed / mean_hr)
    return round((1.0 - efficiency[1] / efficiency[0]) * 100.0, 2) if efficiency[0] else None


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _stream_values(streams: dict[str, list[Any]], stream_type: str, low: float, high: float) -> list[float]:
    return [
        float(value) for value in (_number(item) for item in streams.get(stream_type, []))
        if value is not None and low <= value <= high
    ]


def _distance_splits(streams: dict[str, list[Any]], split_metres: float = 5000.0) -> list[dict[str, Any]]:
    times = streams.get("time")
    distances = streams.get("distance")
    heart_rates = streams.get("heartrate")
    if not times or not distances or len(times) != len(distances):
        return []
    valid_distance = [_number(value) for value in distances]
    if not valid_distance or valid_distance[-1] is None or float(valid_distance[-1]) < split_metres:
        return []
    last_distance = float(valid_distance[-1])
    boundaries = [0.0]
    while boundaries[-1] + split_metres < last_distance:
        boundaries.append(boundaries[-1] + split_metres)
    boundaries.append(last_distance)
    indices: list[int] = []
    for boundary in boundaries:
        index = next(
            (idx for idx, value in enumerate(valid_distance) if value is not None and float(value) >= boundary),
            len(valid_distance) - 1,
        )
        indices.append(index)
    result: list[dict[str, Any]] = []
    for split_number, (start, end) in enumerate(zip(indices, indices[1:]), start=1):
        start_time, end_time = _number(times[start]), _number(times[end])
        start_distance, end_distance = _number(distances[start]), _number(distances[end])
        if None in (start_time, end_time, start_distance, end_distance):
            continue
        duration = float(end_time) - float(start_time)
        km = (float(end_distance) - float(start_distance)) / 1000.0
        if duration <= 0 or km <= 0:
            continue
        hr_values = []
        if heart_rates and len(heart_rates) == len(times):
            hr_values = [
                float(value) for value in (_number(item) for item in heart_rates[start : end + 1])
                if value is not None and 40 <= value <= 230
            ]
        result.append(
            {
                "split": split_number,
                "distance_km": round(km, 3),
                "duration_seconds": round(duration, 1),
                "pace_seconds_per_km": round(duration / km, 2),
                "average_hr": round(float(_mean(hr_values)), 1) if hr_values else None,
                "max_hr": round(max(hr_values), 1) if hr_values else None,
            }
        )
    return result


def _interval_hr_analysis(
    streams: dict[str, list[Any]], segments: list[dict[str, float]]
) -> list[dict[str, Any]]:
    """Describe HR response inside work blocks and between repetitions.

    Recovery drop uses the post-repetition peak (allowing for HR lag) and the
    final 15 seconds before the next repetition. It is descriptive, not a
    lactate or threshold estimate.
    """
    times = streams.get("time")
    heart_rates = streams.get("heartrate")
    if not times or not heart_rates or len(times) != len(heart_rates):
        return []
    result: list[dict[str, Any]] = []
    for index, segment in enumerate(segments):
        start = int(segment["start_index"])
        end = int(segment["end_index"])
        work_hr = [
            float(value) for value in (_number(item) for item in heart_rates[start : end + 1])
            if value is not None and 40 <= value <= 230
        ]
        if len(work_hr) < 30:
            continue
        end_time = float(_number(times[end]) or segment["end_time"])
        end_hr = [
            float(hr) for raw_time, raw_hr in zip(times[start : end + 1], heart_rates[start : end + 1])
            if (time_value := _number(raw_time)) is not None
            and (hr := _number(raw_hr)) is not None
            and time_value >= end_time - 20
            and 40 <= hr <= 230
        ]
        row: dict[str, Any] = {
            "rep": index + 1,
            "distance_km": segment["distance_km"],
            "duration_seconds": segment["duration_seconds"],
            "pace_seconds_per_km": segment["pace_seconds_per_km"],
            "average_hr": round(float(_mean(work_hr) or 0), 1),
            "max_hr": round(max(work_hr), 1),
            "end_hr_20s": round(float(_mean(end_hr) or work_hr[-1]), 1),
        }
        if index + 1 < len(segments):
            next_start = int(segments[index + 1]["start_index"])
            recovery_pairs = [
                (float(time_value), float(hr))
                for raw_time, raw_hr in zip(times[end + 1 : next_start], heart_rates[end + 1 : next_start])
                if (time_value := _number(raw_time)) is not None
                and (hr := _number(raw_hr)) is not None
                and 40 <= hr <= 230
            ]
            if recovery_pairs:
                recovery_start = recovery_pairs[0][0]
                recovery_end = recovery_pairs[-1][0]
                post_peak_values = [hr for time_value, hr in recovery_pairs if time_value <= recovery_start + 20]
                end_values = [hr for time_value, hr in recovery_pairs if time_value >= recovery_end - 15]
                post_peak = max(post_peak_values or [recovery_pairs[0][1]])
                recovered = float(_mean(end_values) or recovery_pairs[-1][1])
                row.update(
                    recovery_seconds=round(recovery_end - recovery_start, 1),
                    recovery_post_rep_peak_hr=round(post_peak, 1),
                    recovery_end_hr_15s=round(recovered, 1),
                    recovery_hr_drop=round(post_peak - recovered, 1),
                )
        result.append(row)
    return result


def _aerobic_hr_analysis(
    streams: dict[str, list[Any]], distance: float, duration: float,
    elevation_gain: float, fast_segments: list[dict[str, float]], sensor_flags: list[str],
    activity_type: str = "", activity_name: str = "",
) -> dict[str, Any]:
    """Return drift only for reasonably steady, flat continuous aerobic runs."""
    pace = duration / distance if distance > 0 else 0
    reasons = []
    if distance < 8 or duration < 2400:
        reasons.append("shorter than 8 km/40 min")
    if fast_segments:
        reasons.append("contains sustained fast blocks")
    if not 240 <= pace <= 360:
        reasons.append("whole-run pace outside aerobic screening band")
    if distance and elevation_gain / distance > 12:
        reasons.append("too hilly for pace/HR drift comparison")
    if sensor_flags:
        reasons.append("HR anomaly flag")
    context = f"{activity_type} {activity_name}".lower()
    if "virtual" in context or "treadmill" in context or "indoor" in context:
        reasons.append("indoor/virtual gradient is not represented reliably")
    speeds = streams.get("velocity_smooth") or streams.get("speed")
    heart_rates = streams.get("heartrate")
    if not speeds or not heart_rates or len(speeds) != len(heart_rates):
        reasons.append("matching speed and HR streams unavailable")
    if reasons:
        return {"eligible": False, "reason": "; ".join(reasons), "drift_percent": None}
    samples = [
        (float(speed), float(hr))
        for raw_speed, raw_hr in zip(speeds, heart_rates)
        if (speed := _number(raw_speed)) is not None
        and (hr := _number(raw_hr)) is not None
        and speed >= 2.5 and 60 <= hr <= 220
    ]
    if len(samples) < 1200:
        return {"eligible": False, "reason": "insufficient valid moving samples", "drift_percent": None}
    trim_start, trim_end = len(samples) // 10, len(samples) - len(samples) // 20
    samples = samples[trim_start:trim_end]
    midpoint = len(samples) // 2
    halves = (samples[:midpoint], samples[midpoint:])
    mean_speeds = [float(_mean([item[0] for item in half]) or 0) for half in halves]
    mean_hrs = [float(_mean([item[1] for item in half]) or 0) for half in halves]
    if not all(mean_speeds) or not all(mean_hrs):
        return {"eligible": False, "reason": "invalid half-run means", "drift_percent": None}
    pace_change = (mean_speeds[1] / mean_speeds[0] - 1) * 100
    if abs(pace_change) > 7:
        return {"eligible": False, "reason": "pace changed by more than 7% between halves", "drift_percent": None}
    efficiencies = [mean_speeds[i] / mean_hrs[i] for i in range(2)]
    return {
        "eligible": True,
        "reason": "steady/flat screening passed",
        "drift_percent": round((1 - efficiencies[1] / efficiencies[0]) * 100, 2),
        "first_half_avg_hr": round(mean_hrs[0], 1),
        "second_half_avg_hr": round(mean_hrs[1], 1),
        "first_half_pace_seconds_per_km": round(1000 / mean_speeds[0], 1),
        "second_half_pace_seconds_per_km": round(1000 / mean_speeds[1], 1),
        "speed_per_hr": round(float(_mean([item[0] / item[1] for item in samples]) or 0), 6),
    }


def _sensor_flags(streams: dict[str, list[Any]], max_hr: Any) -> list[str]:
    flags: list[str] = []
    hr = [_number(v) for v in streams.get("heartrate", [])]
    hr = [v for v in hr if v is not None]
    if hr:
        implausible = sum(1 for v in hr if v < 30 or v > 230)
        jumps = sum(1 for a, b in zip(hr, hr[1:]) if abs(b - a) > 35)
        if implausible:
            flags.append(f"heart-rate values outside 30–230 bpm ({implausible})")
        if jumps > max(2, len(hr) // 100):
            flags.append("frequent abrupt heart-rate jumps")
        if len(set(round(v) for v in hr)) <= 2 and len(hr) > 300:
            flags.append("nearly flat heart-rate trace")
    summary_max = _number(max_hr)
    if summary_max and (summary_max < 60 or summary_max > 230):
        flags.append("implausible summary maximum heart rate")
    return flags


def _normalize_interval(interval: dict[str, Any]) -> dict[str, Any]:
    # The official Interval schema uses metres even for values below 200.
    km = (_number(interval.get("distance")) or 0.0) / 1000.0
    duration = _number(interval.get("moving_time") or interval.get("elapsed_time")) or 0.0
    return {
        **interval,
        "distance_km": round(km, 4),
        "duration_seconds": round(duration, 1),
        "pace_seconds_per_km": seconds_per_km(interval.get("distance"), duration, interval.get("average_speed")),
    }


def process_data() -> list[dict[str, Any]]:
    intervals_summaries = _load(RAW_DIR / "activities.json", [])
    strava_summaries = _load(STRAVA_ACTIVITIES_PATH, [])
    summaries = intervals_summaries + strava_summaries
    raw_running_count = sum(1 for summary in summaries if _is_run(summary))
    feedback = _read_feedback()
    normalized: list[dict[str, Any]] = []
    for summary in summaries:
        activity_id = str(summary.get("id", ""))
        detail = _load(DETAIL_DIR / f"{activity_id}.json", {})
        source = {**summary, **detail}
        day = str(source.get("start_date_local") or source.get("start_date") or "")[:10]
        streams = _stream_map(activity_id)
        intervals = [_normalize_interval(item) for item in source.get("icu_intervals", []) if isinstance(item, dict)]
        messages = _load(MESSAGE_DIR / f"{activity_id}.json", [])
        # Official Activity.distance and Activity.icu_distance are metres,
        # including tiny transition/import fragments below 200 m.
        raw_activity_distance = _number(source.get("icu_distance") or source.get("distance")) or 0.0
        km = raw_activity_distance / 1000.0
        moving = _number(source.get("moving_time") or source.get("icu_recording_time") or source.get("elapsed_time")) or 0
        is_running = _is_run(source)
        elevation_gain = _number(source.get("total_elevation_gain")) or 0.0
        stream_hr = _stream_values(streams, "heartrate", 40, 230)
        stream_cadence = _stream_values(streams, "cadence", 20, 250)
        stream_distances = _stream_values(streams, "distance", 0, 1_000_000)
        stream_times = _stream_values(streams, "time", 0, 1_000_000)
        average_hr = _number(source.get("average_heartrate")) or _mean(stream_hr)
        max_hr = _number(source.get("max_heartrate")) or (max(stream_hr) if stream_hr else None)
        average_cadence = _number(source.get("average_cadence")) or _mean(stream_cadence)
        sensor_flags = _sensor_flags(streams, max_hr)
        fast_segments = _derive_fast_segments(streams) if is_running else []
        row = {
            "id": activity_id,
            "date": day,
            "start_date_local": source.get("start_date_local"),
            "type": source.get("type"),
            "name": source.get("name") or "Untitled activity",
            "description": source.get("description") or "",
            "distance_km": round(km, 3),
            "duration_seconds": round(moving, 1),
            "elapsed_seconds": _number(source.get("elapsed_time")),
            "pace_seconds_per_km": seconds_per_km(source.get("icu_distance") or source.get("distance"), moving, source.get("average_speed")),
            "elevation_gain_m": elevation_gain,
            "elevation_loss_m": _number(source.get("total_elevation_loss")) or 0.0,
            "average_hr": round(float(average_hr), 1) if average_hr is not None else None,
            "max_hr": round(float(max_hr), 1) if max_hr is not None else None,
            "average_cadence": round(float(average_cadence), 1) if average_cadence is not None else None,
            "average_power": _number(source.get("icu_average_watts") or source.get("average_watts")),
            "training_load": _number(source.get("icu_training_load")),
            "intensity": _number(source.get("icu_intensity")),
            "rpe": _number(source.get("icu_rpe") or source.get("perceived_exertion") or source.get("session_rpe")),
            "feel": _number(source.get("feel")),
            "race": bool(source.get("race")),
            "decoupling": _number(source.get("decoupling")),
            "device_name": source.get("device_name"),
            "source": source.get("source"),
            "stream_types": source.get("stream_types") or [],
            "intervals": intervals,
            "messages": messages,
            "manual_feedback": feedback.get(activity_id) or feedback.get(day) or {},
            "sensor_flags": sensor_flags,
            "has_streams": bool(streams),
            "stream_recorded_distance_km": round(stream_distances[-1] / 1000.0, 3) if stream_distances else None,
            "stream_recorded_duration_seconds": round(stream_times[-1], 1) if stream_times else None,
            "stream_intensity_distance_km": _stream_intensity_distance(streams) if is_running else None,
            "fast_segments": fast_segments,
            "interval_hr_reps": _interval_hr_analysis(streams, fast_segments) if is_running else [],
            "distance_splits_5k": _distance_splits(streams) if is_running else [],
            "estimated_hr_pace_drift_percent": _estimate_hr_pace_drift(streams) if is_running else None,
            "aerobic_hr_analysis": _aerobic_hr_analysis(
                streams, km, moving, elevation_gain, fast_segments, sensor_flags,
                str(source.get("type") or ""), str(source.get("name") or ""),
            ) if is_running else None,
            "is_running": is_running,
        }
        normalized.append(row)
    normalized.sort(key=lambda item: item["date"])
    deduplicated: list[dict[str, Any]] = []
    duplicate_groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for row in normalized:
        fingerprint = (
            row.get("start_date_local"),
            row.get("type"),
            round(float(row.get("distance_km") or 0), 3),
            round(float(row.get("duration_seconds") or 0)),
            row.get("average_hr"),
        )
        duplicate_groups.setdefault(fingerprint, []).append(row)
    removed_duplicates: list[dict[str, Any]] = []
    for group in duplicate_groups.values():
        # Exact start/time/distance/HR matches are duplicate imports, not two workouts.
        # Keep the richest record; raw data for every ID remains untouched.
        kept = max(
            group,
            key=lambda item: (
                bool(item.get("has_streams")),
                len(item.get("intervals") or []),
                bool(item.get("description")),
                str(item.get("id")),
            ),
        )
        deduplicated.append(kept)
        for duplicate in group:
            if duplicate is not kept:
                removed_duplicates.append(
                    {
                        "removed_activity_id": duplicate.get("id"),
                        "kept_activity_id": kept.get("id"),
                        "date": duplicate.get("date"),
                        "reason": "Exact start/type/distance/duration/average-HR duplicate import",
                    }
                )
    all_normalized = sorted(deduplicated, key=lambda item: item["date"])
    normalized = [item for item in all_normalized if item.get("is_running")]
    PROCESSING_QUALITY_PATH.write_text(
        json.dumps(
            {
                "raw_running_records": raw_running_count,
                "analysis_running_records": len(normalized),
                "raw_activity_records": len(summaries),
                "raw_intervals_activity_records": len(intervals_summaries),
                "raw_strava_missing_activity_records": len(strava_summaries),
                "analysis_activity_records": len(all_normalized),
                "analysis_activity_type_counts": {
                    activity_type: sum(1 for item in all_normalized if item.get("type") == activity_type)
                    for activity_type in sorted({str(item.get("type")) for item in all_normalized})
                },
                "duplicates_excluded": removed_duplicates,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    PROCESSED_ACTIVITIES_PATH.write_text(json.dumps(normalized, indent=2, ensure_ascii=False), encoding="utf-8")
    PROCESSED_ALL_ACTIVITIES_PATH.write_text(json.dumps(all_normalized, indent=2, ensure_ascii=False), encoding="utf-8")
    csv_fields = [
        "id", "date", "type", "name", "distance_km", "duration_seconds", "pace_seconds_per_km",
        "elevation_gain_m", "average_hr", "max_hr", "average_cadence", "average_power",
        "training_load", "intensity", "rpe", "race", "has_streams",
    ]
    with PROCESSED_ACTIVITIES_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(normalized)
    with PROCESSED_ALL_ACTIVITIES_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_normalized)
    wellness = _load(RAW_DIR / "wellness.json", [])
    PROCESSED_WELLNESS_PATH.write_text(json.dumps(wellness, indent=2, ensure_ascii=False), encoding="utf-8")
    return normalized


if __name__ == "__main__":
    rows = process_data()
    print(f"Processed {len(rows)} running activities.")
