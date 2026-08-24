"""Coach-facing multi-sport, HR, record, and multi-race analysis reports."""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .config import PLAN_DIR, RAW_DIR, REPORTS_DIR
from .metrics import fmt_duration, fmt_pace
from .processing import PROCESSED_ALL_ACTIVITIES_PATH


PACE_CURVES_PATH = RAW_DIR / "running_pace_curves.json"
ROADMAP_JSON_PATH = PLAN_DIR / "multi_race_roadmap.json"


def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _write_multisport(all_activities: list[dict[str, Any]], as_of: date) -> None:
    rows = [row for row in all_activities if row.get("date") and row["date"] <= as_of.isoformat()]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row.get("type") or "Unknown")].append(row)
    lines = [
        "# Multi-sport Training Load", "",
        "Running determines race-specific durability; cycling, swimming and hiking add aerobic load, while strength adds musculoskeletal load. They are not converted into fictional equivalent kilometres.", "",
        "## Available activity inventory", "",
        "| Sport | Sessions | Hours | Distance | Elevation | Intervals load |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for activity_type, items in sorted(grouped.items(), key=lambda pair: sum(float(x.get("duration_seconds") or 0) for x in pair[1]), reverse=True):
        hours = sum(float(item.get("duration_seconds") or 0) for item in items) / 3600
        distance = sum(float(item.get("distance_km") or 0) for item in items)
        elevation = sum(float(item.get("elevation_gain_m") or 0) for item in items)
        load = sum(float(item.get("training_load") or 0) for item in items)
        lines.append(f"| {activity_type} | {len(items)} | {hours:.1f} | {distance:.1f} km | {elevation:.0f} m | {load:.0f} |")
    lines += ["", "## Weekly combined load", "", "| Week | Run km | Run vert | Ride h | Swim h | Hike h | Strength | Total h | Total load |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    weeks: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        weeks[_monday(date.fromisoformat(row["date"]))].append(row)
    for week, items in sorted(weeks.items())[-14:]:
        run = [item for item in items if item.get("is_running")]
        ride = [item for item in items if "ride" in str(item.get("type") or "").lower()]
        swim = [item for item in items if "swim" in str(item.get("type") or "").lower()]
        hike = [item for item in items if str(item.get("type") or "").lower() in {"hike", "walk"}]
        strength = [item for item in items if str(item.get("type") or "").lower() in {"weighttraining", "workout", "strengthtraining"}]
        hours = lambda selected: sum(float(item.get("duration_seconds") or 0) for item in selected) / 3600
        lines.append(
            f"| {week.isoformat()} | {sum(float(x.get('distance_km') or 0) for x in run):.1f} | "
            f"{sum(float(x.get('elevation_gain_m') or 0) for x in run):.0f} m | {hours(ride):.1f} | {hours(swim):.1f} | "
            f"{hours(hike):.1f} | {len(strength)} | {hours(items):.1f} | {sum(float(x.get('training_load') or 0) for x in items):.0f} |"
        )
    lines += [
        "", "## Coaching implication", "",
        "The cross-training materially raises total load in May–July, so a run-only fatigue interpretation is incomplete. It does not, however, replace impact tolerance, HM-pace economy, or downhill conditioning. Future updates therefore retain cycling/swimming as supplementary aerobic work and count hiking/trail elevation as meaningful leg load.", "",
    ]
    (REPORTS_DIR / "multisport_load.md").write_text("\n".join(lines), encoding="utf-8")


def _write_hr(activities: list[dict[str, Any]], as_of: date) -> None:
    cutoff = as_of - timedelta(weeks=8)
    quality = [
        row for row in activities
        if row.get("date") and date.fromisoformat(row["date"]) >= cutoff
        and len(row.get("interval_hr_reps") or []) >= 3
        and not row.get("sensor_flags")
    ]
    steady = [
        row for row in activities
        if row.get("date") and date.fromisoformat(row["date"]) >= cutoff
        and (row.get("aerobic_hr_analysis") or {}).get("eligible")
    ]
    lines = [
        "# Detailed Heart-rate Analysis", "",
        "HR is interpreted with pace, terrain, repeat structure and recovery. The tables are descriptive; they do not infer lactate concentration or a precise threshold HR.", "",
        "## Repetition sessions — last 8 weeks", "",
        "| Date | Session | Work paces | Rep avg HR | Rep max HR | Recovery HR drops |",
        "|---|---|---|---|---|---|",
    ]
    for row in quality:
        reps = row.get("interval_hr_reps") or []
        paces = ", ".join(fmt_pace(rep.get("pace_seconds_per_km")) for rep in reps)
        avgs = ", ".join(str(round(float(rep.get("average_hr") or 0))) for rep in reps)
        maxima = ", ".join(str(round(float(rep.get("max_hr") or 0))) for rep in reps)
        drops = ", ".join(
            f"{float(rep['recovery_hr_drop']):.0f}" for rep in reps if rep.get("recovery_hr_drop") is not None
        ) or "—"
        lines.append(f"| {row['date']} | {row['name']} | {paces} | {avgs} | {maxima} | {drops} bpm |")
    key = next((row for row in activities if row.get("date") == "2026-08-12" and len(row.get("interval_hr_reps") or []) == 3), None)
    lines += ["", "## 12 August — 3 × 3 km", ""]
    if key:
        reps = key["interval_hr_reps"]
        work_blocks = ", ".join(
            f"{rep['distance_km']:.3f} km in {fmt_duration(rep['duration_seconds'])}" for rep in reps
        )
        lines += [
            f"- Stream-derived work blocks: {work_blocks}.",
            f"- Pace progression: {', '.join(fmt_pace(rep['pace_seconds_per_km']) for rep in reps)}.",
            f"- Average HR by rep: {', '.join(str(round(rep['average_hr'])) for rep in reps)} bpm; maxima {', '.join(str(round(rep['max_hr'])) for rep in reps)} bpm.",
            f"- During the two ~3:30 recoveries, HR fell to about {reps[0].get('recovery_end_hr_15s', 0):.0f} and {reps[1].get('recovery_end_hr_15s', 0):.0f} bpm.",
            "- The faster third repetition did not produce the highest HR. Given the verified headwind/tailwind pattern, strong finish and otherwise plausible chest-strap trace, this supports good control but prevents a precise threshold-HR conclusion.",
        ]
    else:
        lines.append("Detailed work blocks were unavailable.")
    hm = next(
        (
            row for row in activities
            if row.get("date") == "2026-01-25" and "winter" in str(row.get("name") or "").lower()
        ),
        None,
    )
    lines += ["", "## 25 January — 2. VCM Winterlauf half marathon", ""]
    if hm:
        lines += [
            "Official performance used by the fitness model: **1:16:40 net**. The Strava replacement description says 1:16:39; the one-second difference is immaterial, but the official result takes priority.",
            f"The recovered Polar/TCX trace contains {hm.get('stream_recorded_distance_km') or '—'} km over {fmt_duration(hm.get('stream_recorded_duration_seconds'))}, average HR {hm.get('average_hr') or '—'} bpm and maximum HR {hm.get('max_hr') or '—'} bpm. Because the device trace is short of the official HM distance, it is used for HR progression and approximate splits—not official pace.",
            "", "| Device segment | Distance | Time | Device pace | Avg HR | Max HR |", "|---|---:|---:|---:|---:|---:|",
        ]
        for split in hm.get("distance_splits_5k") or []:
            lines.append(
                f"| {split['split']} | {split['distance_km']:.3f} km | {fmt_duration(split['duration_seconds'])} | "
                f"{fmt_pace(split['pace_seconds_per_km'])} | {split.get('average_hr') or '—'} | {split.get('max_hr') or '—'} |"
            )
        splits = hm.get("distance_splits_5k") or []
        valid_hr = [split for split in splits if split.get("average_hr") is not None]
        if len(valid_hr) >= 2:
            rise = float(valid_hr[-1]["average_hr"]) - float(valid_hr[0]["average_hr"])
            lines += [
                "",
                f"Average HR rose by about {rise:+.1f} bpm from the first to final recorded segment. At race intensity this is expected HR progression, not an aerobic-decoupling test; it is interpreted with the sustained pace and RPE 9/10.",
            ]
    else:
        lines.append("The race summary or recovered stream was unavailable.")
    lines += ["", "## Steady-run pace/HR drift screen", "", "| Date | Distance | Pace | Avg HR | Drift | Interpretation |", "|---|---:|---:|---:|---:|---|"]
    for row in steady:
        drift = float(row["aerobic_hr_analysis"]["drift_percent"])
        interpretation = "low" if drift <= 3 else "moderate" if drift <= 5 else "elevated"
        lines.append(f"| {row['date']} | {row['distance_km']:.1f} km | {fmt_pace(row.get('pace_seconds_per_km'))} | {row.get('average_hr') or '—'} | {drift:+.1f}% | {interpretation} |")
    recent_drifts = [float(row["aerobic_hr_analysis"]["drift_percent"]) for row in steady[-8:]]
    lines += ["", "## Coaching conclusion", ""]
    if recent_drifts:
        lines.append(f"Median eligible recent drift is {statistics.median(recent_drifts):+.1f}%. Most comparable steady runs show little positive decoupling, which is supportive of aerobic durability. Heat, wind, fuelling and route still limit between-day comparisons.")
    lines += [
        "The 3 × 3 km session is a strong HM-specific marker alongside the official 16:28 5K and the July 4 × 2 km session. HR adds evidence of controlled recovery, but race readiness is not declared from HR alone.", "",
    ]
    (REPORTS_DIR / "hr_analysis.md").write_text("\n".join(lines), encoding="utf-8")


def _write_records() -> None:
    data = _load(PACE_CURVES_PATH, {})
    activity_lookup = {
        str(row.get("id")): row for row in _load(RAW_DIR / "activities.json", []) if row.get("id")
    }
    distances = data.get("distances") or []
    curves = data.get("curves") or []
    labels = {400: "400 m", 800: "800 m", 1000: "1 km", 3000: "3 km", 5000: "5 km", 10000: "10 km", 21097.5: "Half marathon", 42195: "Marathon"}
    floors = {400: 58, 800: 125, 1000: 160, 3000: 520, 5000: 930, 10000: 1950, 21097.5: 4300, 42195: 9000}
    lines = [
        "# Personal Records and Best Efforts", "",
        "Official race results take priority. Intervals pace curves are GPS/device-derived training best efforts and can contain spikes, treadmill calibration error, stops or non-race efforts.", "",
        "## Known official/manual performances", "",
        "- 5K: **16:28**, Tullner Rosenarcade Lauf, 1 July 2026 (official; no special preparation).",
        "- Half marathon: **1:16:40 official net**, 2. VCM Winterlauf Wien, 25 January 2026 (Strava replacement description: 1:16:39).",
        "- Marathon: **2:47:15**, Vienna Marathon, 6 April 2025 (manual athlete context; external result confirms 2:47:15).", "",
        "## Intervals.icu real-pace curve", "",
        "| Distance returned | Fastest raw | Activity date | Status |",
        "|---|---:|---|---|",
    ]
    for idx, distance_raw in enumerate(distances):
        distance = float(distance_raw)
        candidates = [(float(row["secs"][idx]), row) for row in curves if len(row.get("secs") or []) > idx and row["secs"][idx] is not None]
        if not candidates:
            continue
        seconds, row = min(candidates, key=lambda item: item[0])
        nearest = min(labels, key=lambda value: abs(value - distance))
        label = labels[nearest] if abs(nearest - distance) <= max(5, nearest * 0.01) else f"{distance:.0f} m"
        floor = floors.get(nearest)
        source = activity_lookup.get(str(row.get("id")), {})
        source_type = str(source.get("type") or "")
        if "virtual" in source_type.lower():
            status = "virtual-run value; not accepted as an outdoor PB"
        elif floor is not None and seconds < floor:
            status = "flagged implausible/device artefact"
        else:
            status = "plausible GPS training best; not necessarily a race"
        lines.append(f"| {label} ({distance:.1f} m) | {fmt_duration(seconds)} | {str(row.get('start_date_local') or '')[:10]} | {status} |")
    lines += [
        "", "The API activity list itself currently covers only 13 May–13 August 2026, while the pace-curve response also exposes some January 2025 activities. That mismatch means this is not a trustworthy complete lifetime PB catalogue. Add missing official results to `data/manual_race_results.csv`.", "",
    ]
    (REPORTS_DIR / "personal_records.md").write_text("\n".join(lines), encoding="utf-8")


def _post_hm_days() -> list[dict[str, Any]]:
    schedule = {
        "2026-09-28": ("rest", 0, "Full recovery after Bad Ischl."),
        "2026-09-29": ("rest", 0, "Walk/mobility only; run only if legs are unusually good."),
        "2026-09-30": ("recovery", 6, "Very easy, flat."),
        "2026-10-01": ("easy", 8, "Easy rolling, 100–150 m."),
        "2026-10-02": ("rest", 0, "Recovery and mobility."),
        "2026-10-03": ("easy", 10, "Easy rolling, 200 m; no hard descents."),
        "2026-10-04": ("trail easy", 14, "Easy trail, 350–450 m; technique, not intensity."),
        "2026-10-05": ("rest", 0, "Rest."),
        "2026-10-06": ("threshold", 13, "3 km easy; 3 × 8 min controlled threshold on rolling terrain, 2 min jog; cool-down."),
        "2026-10-07": ("easy", 10, "Easy flat/rolling."),
        "2026-10-08": ("hills/strength", 12, "Rolling Z2, 300–400 m; short low-volume strength later."),
        "2026-10-09": ("easy + hills", 10, "Easy plus 6 × 12 s steep hill sprints, full walk-back."),
        "2026-10-10": ("recovery", 8, "Very easy."),
        "2026-10-11": ("trail long", 22, "Trail 700–900 m; controlled climbs and purposeful but non-racing descents."),
        "2026-10-12": ("rest", 0, "Rest."),
        "2026-10-13": ("trail quality", 13, "3 km easy; 5 × 4 min uphill at controlled trail-race effort, easy jog down; cool-down."),
        "2026-10-14": ("easy", 9, "Easy flat."),
        "2026-10-15": ("easy + strides", 10, "Easy rolling plus 5 × 20 s strides."),
        "2026-10-16": ("recovery", 7, "Very easy."),
        "2026-10-17": ("shakeout", 5, "Easy plus 4 × 15 s relaxed strides."),
        "2026-10-18": ("race", 24.7, "Vienna Trail Power Trail, 1000 m: defend title; race by position/effort, not road pace."),
        "2026-10-19": ("rest", 0, "Full recovery."),
        "2026-10-20": ("rest", 0, "Walk/mobility only."),
        "2026-10-21": ("recovery", 6, "Very easy if normal gait; otherwise rest."),
        "2026-10-22": ("easy", 8, "Easy flat."),
        "2026-10-23": ("easy", 10, "Easy rolling."),
        "2026-10-24": ("easy", 12, "Easy rolling, 250 m."),
        "2026-10-25": ("trail easy", 16, "Easy trail, 400–500 m."),
        "2026-10-26": ("rest", 0, "Rest."),
        "2026-10-27": ("threshold hills", 14, "3 km easy; 4 × 8 min threshold on rolling terrain, 2 min jog; cool-down."),
        "2026-10-28": ("easy", 10, "Easy flat."),
        "2026-10-29": ("rolling + strength", 12, "Rolling Z2, 300–400 m; short strength."),
        "2026-10-30": ("hill economy", 10, "Easy plus 8 × 60 s uphill at 5K effort, jog down; controlled."),
        "2026-10-31": ("recovery", 8, "Very easy."),
        "2026-11-01": ("trail long", 21, "Trail 650–800 m, comfortable; practise descending rhythm."),
        "2026-11-02": ("rest", 0, "Rest."),
        "2026-11-03": ("trail tune-up", 12, "3 km easy; 3 × 6 min controlled threshold/rolling, 2 min jog; cool-down."),
        "2026-11-04": ("easy", 9, "Easy flat."),
        "2026-11-05": ("easy + strides", 8, "Easy plus 4 × 20 s strides."),
        "2026-11-06": ("shakeout", 5, "Very easy plus 3 × 15 s."),
        "2026-11-07": ("race (date provisional)", 21, "Kürnberg Long Trail, approximately 700 m; target best possible placing."),
        "2026-11-08": ("rest", 0, "Rest. Move the race here if the organizer confirms Sunday instead of Saturday."),
    }
    return [{"date": day, "type": values[0], "distance_km": values[1], "details": values[2]} for day, values in schedule.items()]


def _write_roadmap(as_of: date) -> None:
    phases = [
        {"dates": "2026-08-13 to 2026-09-27", "goal": "Bad Ischl HM sub-1:15", "focus": "HM-specific endurance, threshold, stable 77–79 km weeks, modest elevation, taper."},
        {"dates": "2026-09-28 to 2026-10-18", "goal": "Vienna Trail title defence", "focus": "Recover first, then concentrate hills/downhill skill and one trail long run; fitness comes mainly from HM block."},
        {"dates": "2026-10-19 to 2026-11-07/08", "goal": "Kürnberg Long Trail win attempt", "focus": "Recover, rebuild one trail-specific week, sharpen, taper."},
        {"dates": "2026-11-09 to 2026-12-06", "goal": "Transition", "focus": "2 easy weeks, restore strength, then rebuild frequency; no forced marathon work."},
        {"dates": "2026-12-07 to 2027-01-17", "goal": "Marathon base", "focus": "Progress sustainable run volume and long-run durability; threshold maintenance; strength 2×/week."},
        {"dates": "2027-01-18 to 2027-03-14", "goal": "Linz marathon-specific build", "focus": "Long runs 28–35 km, medium-long runs, threshold, progressive blocks around marathon effort; target pace ~3:47.5/km only after fitness validation."},
        {"dates": "2027-03-15 to 2027-04-11", "goal": "Peak and taper", "focus": "Final specific long runs, then maintain intensity while reducing volume into Linz."},
    ]
    days = _post_hm_days()
    ROADMAP_JSON_PATH.write_text(json.dumps({"generated_as_of": as_of.isoformat(), "phases": phases, "post_hm_days": days}, indent=2), encoding="utf-8")
    lines = [
        "# Multi-race Roadmap", "",
        "## Race hierarchy", "",
        "1. Bad Ischl Half Marathon — 27 September 2026 — performance target sub-1:15.",
        "2. Vienna Trail Power Trail — 18 October 2026 — defend the title; 24.7 km / 1000 m.",
        "3. Kürnberg Long Trail — date currently provisional (7–8 November 2026) — target first place; approximately 20–21 km / 700 m based on the current/previous course information.",
        "4. Linz Marathon — 11 April 2027 — development target sub-2:40 (~3:47.5/km).", "",
        "Winning trail races depends on the start list, terrain, conditions and race execution; the controllable objective is to arrive maximally prepared without sacrificing Bad Ischl.", "",
        "## Phase plan", "", "| Dates | Objective | Focus |", "|---|---|---|",
    ]
    for phase in phases:
        lines.append(f"| {phase['dates']} | {phase['goal']} | {phase['focus']} |")
    lines += ["", "## Provisional daily transition after Bad Ischl", "", "This section must be regenerated from actual HM recovery and trail-race confirmation; completed days will not be rewritten.", "", "| Date | Type | Distance | Details |", "|---|---|---:|---|"]
    for item in days:
        lines.append(f"| {item['date']} | {item['type']} | {item['distance_km']:.1f} km | {item['details']} |")
    lines += [
        "", "## Sub-2:40 checkpoint logic", "",
        "Sub-2:40 is 7:15 faster than the verified 2025 marathon PB. It is a credible long-term objective, not yet a prescribed race pace. Before the marathon-specific block, require healthy consistent mileage, long-run recovery, and a winter race/threshold marker broadly compatible with the target. The exact January–April daily plan should be generated after the trail season, because present fatigue and volume cannot responsibly specify workouts eight months ahead.", "",
    ]
    (REPORTS_DIR / "multi_race_roadmap.md").write_text("\n".join(lines), encoding="utf-8")


def write_advanced_reports(activities: list[dict[str, Any]], assessment: dict[str, Any], as_of: date) -> None:
    all_activities = _load(PROCESSED_ALL_ACTIVITIES_PATH, [])
    _write_multisport(all_activities, as_of)
    _write_hr(activities, as_of)
    _write_records()
    _write_roadmap(as_of)
