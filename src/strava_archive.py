"""Import missing activities from a local Strava archive without uploading anything."""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import fitdecode

from .config import RAW_DIR, get_settings


INTERVALS_ACTIVITIES_PATH = RAW_DIR / "activities.json"
STRAVA_ACTIVITIES_PATH = RAW_DIR / "strava_missing_activities.json"
STRAVA_QUALITY_PATH = RAW_DIR / "strava_import_quality.json"
STRAVA_STREAM_DIR = RAW_DIR / "strava_streams"
VIENNA = ZoneInfo("Europe/Vienna")


def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _float(value: Any) -> float | None:
    try:
        result = float(str(value).strip())
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _seconds(value: Any) -> int | None:
    number = _float(value)
    return round(number) if number is not None and number >= 0 else None


def _bool(value: Any) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes", "y"}


def _unique_headers(headers: list[str]) -> list[str]:
    counts: Counter[str] = Counter()
    result: list[str] = []
    for raw in headers:
        name = raw.strip()
        counts[name] += 1
        result.append(name if counts[name] == 1 else f"{name}_{counts[name]}")
    return result


def _read_activity_rows(archive: zipfile.ZipFile) -> list[dict[str, str]]:
    with archive.open("activities.csv") as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        reader = csv.reader(text)
        headers = _unique_headers(next(reader))
        return [dict(zip(headers, row)) for row in reader]


def _local_start(raw: str) -> datetime | None:
    try:
        utc_naive = datetime.strptime(raw.strip(), "%b %d, %Y, %I:%M:%S %p")
    except (ValueError, AttributeError):
        return None
    return utc_naive.replace(tzinfo=timezone.utc).astimezone(VIENNA)


def _activity_type(value: str) -> str:
    cleaned = str(value or "Other").replace(" ", "")
    aliases = {"E-BikeRide": "EBikeRide"}
    return aliases.get(cleaned, cleaned or "Other")


def _normalized_sport(value: str) -> str:
    cleaned = str(value or "").replace(" ", "").lower()
    if cleaned.endswith("run") or cleaned in {"run", "running", "treadmill"}:
        return "run"
    if cleaned.endswith("ride") or cleaned in {"ride", "cycling"}:
        return "ride"
    if "swim" in cleaned:
        return "swim"
    if cleaned in {"weighttraining", "workout", "strengthtraining"}:
        return "strength"
    return cleaned


def _summary(row: dict[str, str]) -> dict[str, Any] | None:
    start = _local_start(row.get("Activity Date", ""))
    activity_id = str(row.get("Activity ID") or "").strip()
    if start is None or not activity_id:
        return None
    distance_metres = _float(row.get("Distance_2"))
    if distance_metres is None:
        first_distance_km = _float(row.get("Distance"))
        distance_metres = first_distance_km * 1000 if first_distance_km is not None else 0.0
    moving = _seconds(row.get("Moving Time")) or _seconds(row.get("Elapsed Time_2")) or _seconds(row.get("Elapsed Time")) or 0
    elapsed = _seconds(row.get("Elapsed Time_2")) or _seconds(row.get("Elapsed Time")) or moving
    activity_type = _activity_type(row.get("Activity Type", ""))
    name = str(row.get("Activity Name") or "Untitled Strava activity").strip()
    description = str(row.get("Activity Description") or "").strip()
    race_name = name.lower()
    training_words = ("pace", "prep", "interval", "tempo", "session", "training")
    likely_race = _bool(row.get("Competition")) or "winter series" in race_name or "wettkampf" in race_name or " race" in race_name
    if "marathon" in race_name and not any(word in race_name for word in training_words):
        likely_race = True
    return {
        "id": f"strava_{activity_id}",
        "strava_activity_id": activity_id,
        "start_date": start.astimezone(timezone.utc).isoformat(),
        "start_date_local": start.replace(tzinfo=None).isoformat(),
        "type": activity_type,
        "name": name,
        "description": description,
        "distance": round(distance_metres, 3),
        "moving_time": moving,
        "elapsed_time": elapsed,
        "total_elevation_gain": _float(row.get("Elevation Gain")) or 0.0,
        "total_elevation_loss": _float(row.get("Elevation Loss")) or 0.0,
        "average_heartrate": _float(row.get("Average Heart Rate")),
        "max_heartrate": _float(row.get("Max Heart Rate_2") or row.get("Max Heart Rate")),
        "average_cadence": _float(row.get("Average Cadence")),
        "average_watts": _float(row.get("Average Watts")),
        "max_watts": _float(row.get("Max Watts")),
        "calories": _float(row.get("Calories")),
        "icu_training_load": _float(row.get("Training Load")) or _float(row.get("Relative Effort_2") or row.get("Relative Effort")),
        "icu_intensity": _float(row.get("Intensity")),
        "perceived_exertion": _float(row.get("Perceived Exertion")),
        "race": likely_race,
        "source": "STRAVA_ARCHIVE",
        "external_id": activity_id,
        "strava_filename": str(row.get("Filename") or "").strip(),
    }


def _parse_iso_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _child_text(element: ET.Element, local_name: str) -> str | None:
    for child in element.iter():
        if child.tag.rsplit("}", 1)[-1] == local_name and child.text:
            return child.text
    return None


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    value = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(value))


def _xml_streams(data: bytes, filename: str) -> list[dict[str, Any]]:
    if filename.lower().endswith(".gz"):
        data = gzip.decompress(data)
        filename = filename[:-3]
    if not filename.lower().endswith((".tcx", ".gpx")):
        return []
    root = ET.fromstring(data)
    points = [element for element in root.iter() if element.tag.rsplit("}", 1)[-1] in {"Trackpoint", "trkpt"}]
    times: list[float] = []
    distances: list[float] = []
    altitudes: list[float | None] = []
    heart_rates: list[float | None] = []
    cadences: list[float | None] = []
    first_time: datetime | None = None
    cumulative = 0.0
    previous_position: tuple[float, float] | None = None
    for point in points:
        parsed_time = _parse_iso_time(_child_text(point, "Time") or _child_text(point, "time") or "")
        if parsed_time is None:
            continue
        if first_time is None:
            first_time = parsed_time
        distance_value = _float(_child_text(point, "DistanceMeters"))
        if distance_value is None and point.tag.rsplit("}", 1)[-1] == "trkpt":
            lat, lon = _float(point.attrib.get("lat")), _float(point.attrib.get("lon"))
            if lat is not None and lon is not None:
                if previous_position is not None:
                    cumulative += _haversine(previous_position[0], previous_position[1], lat, lon)
                previous_position = (lat, lon)
                distance_value = cumulative
        if distance_value is None:
            continue
        hr_value = _float(_child_text(point, "Value")) or _float(_child_text(point, "hr"))
        cadence_value = _float(_child_text(point, "Cadence")) or _float(_child_text(point, "cad"))
        times.append(round((parsed_time - first_time).total_seconds(), 3))
        distances.append(round(distance_value, 3))
        altitudes.append(_float(_child_text(point, "AltitudeMeters") or _child_text(point, "ele")))
        heart_rates.append(hr_value)
        cadences.append(cadence_value)
    if len(times) < 2:
        return []
    speeds: list[float] = [0.0]
    for index in range(1, len(times)):
        delta_time = times[index] - times[index - 1]
        delta_distance = distances[index] - distances[index - 1]
        speeds.append(round(max(0.0, delta_distance / delta_time), 4) if delta_time > 0 and delta_distance >= 0 else 0.0)
    streams: list[dict[str, Any]] = [
        {"type": "time", "data": times},
        {"type": "distance", "data": distances},
        {"type": "velocity_smooth", "data": speeds},
    ]
    for stream_type, values in (("altitude", altitudes), ("heartrate", heart_rates), ("cadence", cadences)):
        if any(value is not None for value in values):
            streams.append({"type": stream_type, "data": values})
    return streams


def _fit_streams(data: bytes, filename: str) -> list[dict[str, Any]]:
    if filename.lower().endswith(".gz"):
        data = gzip.decompress(data)
        filename = filename[:-3]
    if not filename.lower().endswith(".fit"):
        return []
    times: list[float] = []
    distances: list[float | None] = []
    speeds: list[float | None] = []
    altitudes: list[float | None] = []
    heart_rates: list[float | None] = []
    cadences: list[float | None] = []
    watts: list[float | None] = []
    first_time: datetime | None = None
    with fitdecode.FitReader(io.BytesIO(data)) as fit:
        for frame in fit:
            if not isinstance(frame, fitdecode.FitDataMessage) or frame.name != "record":
                continue
            timestamp = frame.get_value("timestamp", fallback=None)
            if not isinstance(timestamp, datetime):
                continue
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            if first_time is None:
                first_time = timestamp
            distance_value = _float(frame.get_value("distance", fallback=None))
            times.append(round((timestamp - first_time).total_seconds(), 3))
            distances.append(distance_value)
            speeds.append(_float(frame.get_value("enhanced_speed", fallback=None)) or _float(frame.get_value("speed", fallback=None)))
            altitudes.append(_float(frame.get_value("enhanced_altitude", fallback=None)) or _float(frame.get_value("altitude", fallback=None)))
            heart_rates.append(_float(frame.get_value("heart_rate", fallback=None)))
            cadences.append(_float(frame.get_value("cadence", fallback=None)))
            watts.append(_float(frame.get_value("power", fallback=None)))
    if len(times) < 2:
        return []
    # Some devices omit distance on occasional records; forward-fill only after
    # the first valid point so no synthetic movement is introduced.
    last_distance: float | None = None
    filled_distances: list[float] = []
    for value in distances:
        if value is not None:
            last_distance = value
        filled_distances.append(last_distance if last_distance is not None else 0.0)
    if not any(value > 0 for value in filled_distances):
        return []
    streams: list[dict[str, Any]] = [
        {"type": "time", "data": times},
        {"type": "distance", "data": filled_distances},
    ]
    for stream_type, values in (
        ("velocity_smooth", speeds), ("altitude", altitudes), ("heartrate", heart_rates),
        ("cadence", cadences), ("watts", watts),
    ):
        if any(value is not None for value in values):
            streams.append({"type": stream_type, "data": values})
    return streams


def _recording_streams(data: bytes, filename: str) -> list[dict[str, Any]]:
    normalized = filename.lower().removesuffix(".gz")
    if normalized.endswith((".tcx", ".gpx")):
        return _xml_streams(data, filename)
    if normalized.endswith(".fit"):
        return _fit_streams(data, filename)
    return []


def _matches_intervals(candidate: dict[str, Any], intervals: list[dict[str, Any]]) -> bool:
    start = datetime.fromisoformat(candidate["start_date"]).astimezone(timezone.utc)
    candidate_distance = float(candidate.get("distance") or 0)
    candidate_duration = float(candidate.get("moving_time") or 0)
    sport = _normalized_sport(str(candidate.get("type") or ""))
    for existing in intervals:
        if _normalized_sport(str(existing.get("type") or "")) != sport:
            continue
        raw_start = str(existing.get("start_date") or "")
        try:
            existing_start = datetime.fromisoformat(raw_start.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            continue
        if abs((start - existing_start).total_seconds()) > 300:
            continue
        existing_distance = float(existing.get("distance") or existing.get("icu_distance") or 0)
        existing_duration = float(existing.get("moving_time") or existing.get("elapsed_time") or 0)
        distance_close = (
            candidate_distance <= 0 or existing_distance <= 0
            or abs(candidate_distance - existing_distance) <= max(250.0, candidate_distance * 0.04)
        )
        duration_close = (
            candidate_duration <= 0 or existing_duration <= 0
            or abs(candidate_duration - existing_duration) <= max(120.0, candidate_duration * 0.08)
        )
        if distance_close and duration_close:
            return True
    return False


def _stream_donor(candidate: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any] | None:
    """Find a misdated duplicate that still owns the original recording file."""
    candidate_duration = float(candidate.get("moving_time") or 0)
    candidate_distance = float(candidate.get("distance") or 0)
    candidate_tokens = {
        token.strip("❄️:;,.!?").lower()
        for token in str(candidate.get("name") or "").split()
        if len(token.strip("❄️:;,.!?")) >= 4
    }
    matches: list[tuple[int, float, dict[str, Any]]] = []
    for row in rows:
        filename = str(row.get("Filename") or "").strip()
        if not filename:
            continue
        donor = _summary(row)
        if donor is None or donor.get("id") == candidate.get("id"):
            continue
        if _normalized_sport(str(donor.get("type") or "")) != _normalized_sport(str(candidate.get("type") or "")):
            continue
        donor_duration = float(donor.get("moving_time") or 0)
        donor_distance = float(donor.get("distance") or 0)
        if abs(candidate_duration - donor_duration) > 15 or abs(candidate_distance - donor_distance) > 500:
            continue
        donor_tokens = {
            token.strip("❄️:;,.!?").lower()
            for token in str(donor.get("name") or "").split()
            if len(token.strip("❄️:;,.!?")) >= 4
        }
        overlap = len(candidate_tokens & donor_tokens)
        if overlap >= 2:
            matches.append((overlap, abs(candidate_distance - donor_distance), donor))
    return max(matches, key=lambda item: (item[0], -item[1]))[2] if matches else None


def import_archive(path: Path, oldest: date, newest: date) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Strava archive not found: {path}")
    intervals = _load(INTERVALS_ACTIVITIES_PATH, [])
    imported: list[dict[str, Any]] = []
    matched = invalid = stream_count = 0
    file_types: Counter[str] = Counter()
    with zipfile.ZipFile(path) as archive:
        available = set(archive.namelist())
        rows = _read_activity_rows(archive)
        for row in rows:
            summary = _summary(row)
            if summary is None:
                invalid += 1
                continue
            activity_day = date.fromisoformat(summary["start_date_local"][:10])
            if not oldest <= activity_day <= newest:
                continue
            if _matches_intervals(summary, intervals):
                matched += 1
                continue
            filename = str(summary.get("strava_filename") or "")
            if not filename:
                donor = _stream_donor(summary, rows)
                if donor:
                    filename = str(donor.get("strava_filename") or "")
                    summary["strava_stream_donor_activity_id"] = donor.get("strava_activity_id")
                    summary["strava_stream_donor_original_date"] = donor.get("start_date_local")
            if filename:
                file_types[Path(filename.removesuffix(".gz")).suffix.lower() or "unknown"] += 1
                if filename in available:
                    try:
                        streams = _recording_streams(archive.read(filename), filename)
                        if streams:
                            _write(STRAVA_STREAM_DIR / f"{summary['id']}.json", streams)
                            summary["stream_types"] = [item["type"] for item in streams]
                            stream_count += 1
                    except (OSError, EOFError, ET.ParseError, gzip.BadGzipFile):
                        pass
            imported.append(summary)
    imported.sort(key=lambda item: item["start_date_local"])
    _write(STRAVA_ACTIVITIES_PATH, imported)
    report = {
        "archive": path.name,
        "range": {"oldest": oldest.isoformat(), "newest": newest.isoformat()},
        "intervals_activity_count": len(intervals),
        "strava_rows_matched_to_intervals": matched,
        "strava_missing_activities_imported": len(imported),
        "missing_activity_file_types": dict(file_types),
        "recording_streams_parsed": stream_count,
        "xml_streams_parsed": stream_count,
        "invalid_rows": invalid,
        "notes": [
            "Strava archive timestamps were interpreted as UTC and converted to Europe/Vienna.",
            "Only activities absent from the Intervals cache were retained.",
            "TCX, GPX and FIT streams were parsed locally when the recording file was valid.",
            "Nothing was uploaded to Strava or Intervals.icu.",
        ],
    }
    _write(STRAVA_QUALITY_PATH, report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Import only Intervals-missing activities from a local Strava archive")
    parser.add_argument("--zip", required=True, type=Path, help="Path to the Strava export ZIP")
    args = parser.parse_args()
    settings = get_settings(require_credentials=False)
    oldest = settings.as_of_date - timedelta(days=round(settings.history_months * 30.4375))
    report = import_archive(args.zip, oldest, settings.as_of_date)
    print(
        f"Matched {report['strava_rows_matched_to_intervals']} Strava rows to Intervals; "
        f"imported {report['strava_missing_activities_imported']} missing activities with "
        f"{report['recording_streams_parsed']} parsed recording stream files."
    )


if __name__ == "__main__":
    main()
