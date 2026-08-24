"""Synchronize Intervals.icu data into a local, read-only cache."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import CACHE_DIR, RAW_DIR, Settings, get_settings
from .intervals_api import IntervalsAPIError, IntervalsClient, redact_sensitive


LOG = logging.getLogger(__name__)
MANIFEST_PATH = CACHE_DIR / "sync_manifest.json"
ACTIVITIES_PATH = RAW_DIR / "activities.json"
WELLNESS_PATH = RAW_DIR / "wellness.json"
ATHLETE_PATH = RAW_DIR / "athlete.json"
QUALITY_PATH = RAW_DIR / "data_quality.json"
PACE_CURVES_PATH = RAW_DIR / "running_pace_curves.json"
DETAIL_DIR = RAW_DIR / "activity_details"
STREAM_DIR = RAW_DIR / "streams"
MESSAGE_DIR = RAW_DIR / "messages"
RUN_TYPES = {"run", "virtualrun", "trailrun", "treadmill", "running"}
CARDIO_TYPES = RUN_TYPES | {
    "ride", "virtualride", "gravelride", "mountainbikeride", "swim",
    "openwaterswim", "hike", "walk", "elliptical", "rowing", "nordicski",
}
USEFUL_STREAMS = {
    "time", "distance", "velocity_smooth", "speed", "pace", "heartrate", "altitude",
    "elevation", "cadence", "watts", "running_power", "grade_smooth", "moving",
}


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(redact_sensitive(data), indent=2, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)


def _safe_id(activity_id: str) -> str:
    return "".join(c for c in activity_id if c.isalnum() or c in ("-", "_"))


def _fingerprint(activity: dict[str, Any]) -> str:
    watched = {
        key: activity.get(key)
        for key in (
            "id", "analyzed", "icu_sync_date", "name", "description", "distance",
            "moving_time", "elapsed_time", "icu_training_load", "icu_rpe", "feel",
            "stream_types", "icu_lap_count",
        )
    }
    encoded = json.dumps(watched, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _is_run(activity: dict[str, Any]) -> bool:
    activity_type = str(activity.get("type") or "").replace(" ", "").lower()
    return activity_type in RUN_TYPES or activity_type.endswith("run")


def _is_cardio(activity: dict[str, Any]) -> bool:
    activity_type = str(activity.get("type") or "").replace(" ", "").lower()
    return _is_run(activity) or activity_type in CARDIO_TYPES or activity_type.endswith("ride")


def _activity_date(activity: dict[str, Any]) -> date | None:
    raw = activity.get("start_date_local") or activity.get("start_date")
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _filter_athlete(data: dict[str, Any]) -> dict[str, Any]:
    """Keep analysis-relevant profile data, excluding account/contact/integration fields."""
    allowed = {
        "id", "name", "firstname", "lastname", "sex", "timezone", "measurement_preference",
        "weight", "icu_weight", "icu_resting_hr", "height", "height_units", "icu_type_settings",
    }
    return {key: value for key, value in data.items() if key in allowed}


def _filter_streams(streams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in streams if str(item.get("type", "")).lower() in USEFUL_STREAMS]


def sync_data(settings: Settings, full: bool = False) -> dict[str, Any]:
    settings.require_credentials()
    client = IntervalsClient(settings)
    manifest = _read_json(MANIFEST_PATH, {})
    now = datetime.now(timezone.utc)
    history_oldest = settings.as_of_date - timedelta(days=round(settings.history_months * 30.4375))
    last_sync_raw = manifest.get("last_successful_sync")
    if not full and ACTIVITIES_PATH.exists() and last_sync_raw:
        try:
            last_sync_date = datetime.fromisoformat(last_sync_raw.replace("Z", "+00:00")).date()
            fetch_oldest = max(history_oldest, last_sync_date - timedelta(days=21))
        except ValueError:
            fetch_oldest = history_oldest
    else:
        fetch_oldest = history_oldest

    LOG.info("Fetching activity summaries from %s through %s", fetch_oldest, settings.as_of_date)
    fetched = client.list_activities(fetch_oldest, settings.as_of_date)
    previous = _read_json(ACTIVITIES_PATH, [])
    # Treat the fetched overlap as authoritative so deletions do not survive locally forever.
    merged = {
        str(item.get("id")): item
        for item in previous
        if item.get("id") and ((_activity_date(item) or date.min) < fetch_oldest)
    }
    merged.update({str(item.get("id")): item for item in fetched if item.get("id")})
    activities = sorted(merged.values(), key=lambda x: x.get("start_date_local", ""))
    _write_json(ACTIVITIES_PATH, activities)

    # The athlete response can contain account secrets; retain only a strict analysis allow-list.
    _write_json(ATHLETE_PATH, _filter_athlete(client.get_athlete()))

    wellness_fetched = client.list_wellness(fetch_oldest, settings.as_of_date)
    wellness_previous = _read_json(WELLNESS_PATH, [])
    wellness = {str(item.get("id")): item for item in wellness_previous if item.get("id")}
    wellness.update({str(item.get("id")): item for item in wellness_fetched if item.get("id")})
    wellness_rows = sorted(wellness.values(), key=lambda x: x.get("id", ""))
    _write_json(WELLNESS_PATH, wellness_rows)

    try:
        pace_curves = client.list_activity_pace_curves(
            history_oldest,
            settings.as_of_date,
            distances=(400, 800, 1000, 1609.344, 3000, 5000, 10000, 21097.5, 42195),
            activity_type="Run",
            gap=False,
        )
        _write_json(PACE_CURVES_PATH, pace_curves)
    except IntervalsAPIError as exc:
        pace_curves = None

    detail_cutoff = settings.as_of_date - timedelta(weeks=settings.detail_weeks)
    old_fingerprints = manifest.get("activity_fingerprints", {})
    fingerprints = dict(old_fingerprints)
    issues: list[dict[str, str]] = []
    detail_count = stream_count = cached_count = 0
    for activity in activities:
        activity_id = str(activity.get("id"))
        activity_date = _activity_date(activity)
        if activity_date is None:
            issues.append({"activity_id": activity_id, "issue": "Missing or invalid activity date"})
            continue
        is_historical_race = _is_run(activity) and (
            bool(activity.get("race")) or "race" in str(activity.get("name", "")).lower()
        )
        needs_detail = activity_date >= detail_cutoff or is_historical_race
        if not needs_detail:
            continue
        safe_id = _safe_id(activity_id)
        detail_path = DETAIL_DIR / f"{safe_id}.json"
        current_fingerprint = _fingerprint(activity)
        changed = full or not detail_path.exists() or fingerprints.get(activity_id) != current_fingerprint
        if not changed:
            cached_count += 1
            continue
        try:
            detail = client.get_activity(activity_id, include_intervals=True)
            _write_json(detail_path, detail)
            detail_count += 1
            try:
                messages = client.list_activity_messages(activity_id)
                if messages:
                    _write_json(MESSAGE_DIR / f"{safe_id}.json", messages)
            except IntervalsAPIError as exc:
                issues.append({"activity_id": activity_id, "issue": f"Messages unavailable: {exc}"})

            if activity_date >= detail_cutoff and _is_cardio(activity) and detail.get("stream_types"):
                try:
                    streams = _filter_streams(client.get_activity_streams(activity_id))
                    _write_json(STREAM_DIR / f"{safe_id}.json", streams)
                    stream_count += 1
                except IntervalsAPIError as exc:
                    # Strava-sourced activity redistribution or missing streams may cause this.
                    issues.append({"activity_id": activity_id, "issue": f"Streams unavailable: {exc}"})
            fingerprints[activity_id] = current_fingerprint
        except IntervalsAPIError as exc:
            issues.append({"activity_id": activity_id, "issue": f"Detail unavailable: {exc}"})

    run_count = sum(1 for item in activities if _is_run(item))
    report = {
        "synced_at": now.isoformat(),
        "range": {"oldest": history_oldest.isoformat(), "newest": settings.as_of_date.isoformat()},
        "activity_count": len(activities),
        "running_activity_count": run_count,
        "wellness_record_count": len(wellness_rows),
        "pace_curves_downloaded": pace_curves is not None,
        "detail_downloads": detail_count,
        "stream_downloads": stream_count,
        "unchanged_details_reused": cached_count,
        "issues": issues,
        "notes": [
            "Historical summaries cover the configured history window.",
            "Intervals and streams are cached for the detailed recent window and historical races.",
            "Some Strava-sourced files or streams may be unavailable due to source-platform policy.",
        ],
    }
    _write_json(QUALITY_PATH, report)
    _write_json(
        MANIFEST_PATH,
        {
            "last_successful_sync": now.isoformat(),
            "last_full_sync": now.isoformat() if full or not manifest.get("last_full_sync") else manifest["last_full_sync"],
            "activity_fingerprints": fingerprints,
        },
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only synchronization from Intervals.icu")
    parser.add_argument("--full", action="store_true", help="Refresh the full configured history window")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s: %(message)s")
    try:
        report = sync_data(get_settings(require_credentials=True), full=args.full)
    except Exception as exc:
        if isinstance(exc, KeyboardInterrupt):
            raise
        raise SystemExit(str(exc)) from exc
    print(
        f"Synced {report['running_activity_count']} running activities and "
        f"{report['wellness_record_count']} wellness records."
    )


if __name__ == "__main__":
    main()
