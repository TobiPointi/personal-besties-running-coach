"""Build evidence-backed Markdown reports from synchronized local data."""

from __future__ import annotations

import argparse
import json
import statistics
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .coach import generate_plan, load_profile, write_plan
from .advanced_analysis import write_advanced_reports
from .config import ATHLETE_PROFILE_PATH, PROCESSED_DIR, REPORTS_DIR, get_settings
from .dashboard import write_dashboard
from .metrics import build_assessment, fmt_duration, fmt_pace
from .processing import PROCESSED_ALL_ACTIVITIES_PATH, PROCESSED_WELLNESS_PATH, process_data


def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _fitness_section(fitness: dict[str, Any]) -> list[str]:
    lines = ["# Current Fitness", ""]
    for key, label in (("5k", "5K"), ("10k", "10K"), ("half_marathon", "Half marathon")):
        item = fitness[key]
        lines += [
            f"## {label}", "",
            f"- Likely range: **{item['likely_range']}**",
            f"- Confidence: **{item['confidence']}**",
            f"- Supporting evidence: {'; '.join(item['supporting_evidence'])}",
            f"- Evidence against / uncertainty: {'; '.join(item['evidence_against'])}", "",
        ]
    goal = fitness["goal_feasibility"]
    lines += [
        "## Sub-1:15 feasibility", "",
        f"**{goal['rating']} confidence ({goal['confidence']} evidence quality).** {goal['reason']}", "",
        f"Conditional race-day range: **{goal.get('conditional_race_day_range', 'unavailable')}**. {goal.get('forecast_assumptions', '')}", "",
        "These estimates combine recent races and sustained interval/HM-specific work when available. They are not based on one equivalence calculator or old PBs alone.", "",
    ]
    return lines


def write_reports(activities: list[dict[str, Any]], assessment: dict[str, Any], as_of: date) -> None:
    profile = load_profile()
    weeks = assessment["recent_weeks"]
    athlete_lines = [
        "# Athlete Profile", "",
        "> Edit `data/athlete_profile.json` to maintain this context. API data has priority for current fitness.", "",
        f"- Athlete: {profile['athlete']['name']}",
        f"- Primary sport: {profile['athlete']['primary_sport']}",
        f"- Watch: {profile['equipment']['watch']}",
        f"- Goal race: {profile['goal_race']['name']} — {profile['goal_race']['date']}",
        f"- Goal: {profile['goal_race']['goal']} ({profile['goal_race']['goal_pace']})",
        f"- 5K: {profile['known_performances']['5k']}",
        f"- Marathon PB: {profile['known_performances']['marathon_pb']}",
        f"- Half marathon PB: {profile['known_performances']['half_marathon_pb']}",
        f"- Current objective: {profile['current_objective']}",
        f"- Future races: {profile['future_races']}",
        f"- HR context: {profile['heart_rate_context']}", "",
        "Old PBs are context only; synchronized current training controls the analysis and plan.", "",
    ]
    (REPORTS_DIR / "athlete_profile.md").write_text("\n".join(athlete_lines), encoding="utf-8")

    history = ["# Training History", "", f"Synchronized running activities: **{len(activities)}**", ""]
    if activities:
        history += [f"Available date range: **{activities[0]['date']} to {activities[-1]['date']}**", ""]
    history += [
        "## Recent weekly detail", "",
        "| Week | km | Hours | Elevation | Days | Longest | Quality km | HM-specific | Threshold | Faster | Load |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for week in weeks:
        history.append(
            f"| {week['week_start']} | {week['distance_km']:.1f} | {week['duration_hours']:.1f} | {week['elevation_gain_m']:.0f} m | "
            f"{week['running_days']} | {week['longest_run_km']:.1f} | {week['quality_session_volume_km']:.1f} | "
            f"{week['hm_specific_km']:.1f} | {week['threshold_km']:.1f} | {week['faster_than_threshold_km']:.1f} | {week['training_load']:.0f} |"
        )
    history += ["", "Pace-derived intensity is an estimate. Lap data are preferred; whole-run pace is used only when detailed laps are unavailable.", ""]
    all_weekly = _load(PROCESSED_DIR / "weekly_metrics.json", [])
    complete_all = [week for week in all_weekly if date.fromisoformat(week["week_end"]) <= as_of]
    last_52 = [week for week in complete_all if date.fromisoformat(week["week_start"]) >= as_of - timedelta(weeks=52)]
    long_runs = sorted(
        [row for row in activities if (row.get("distance_km") or 0) >= 18],
        key=lambda row: row.get("date", ""),
        reverse=True,
    )
    races = [row for row in activities if row.get("race") or "race" in f"{row.get('name', '')} {row.get('description', '')}".lower()]
    history += ["## Long-term context", ""]
    if complete_all:
        peak = max(complete_all, key=lambda week: week["distance_km"])
        avg52 = statistics.mean(week["distance_km"] for week in last_52) if last_52 else 0
        consistent52 = sum(week["running_days"] >= 4 for week in last_52)
        history += [
            f"- Historical peak complete week in the synchronized window: {peak['distance_km']:.1f} km (week of {peak['week_start']}).",
            f"- Mean complete-week volume over the last 52 weeks available: {avg52:.1f} km.",
            f"- Consistency: {consistent52}/{len(last_52)} complete weeks in the last year had at least four running days." if last_52 else "- Last-year consistency unavailable.",
        ]
    else:
        history.append("- Complete-week long-term statistics unavailable.")
    history += ["", "### Recent long runs", ""]
    if long_runs:
        history += [f"- {row['date']}: {row['distance_km']:.1f} km — {row['name']}" for row in long_runs[:12]]
    else:
        history.append("- No ≥18 km run is available in the synchronized data.")
    history += ["", "### Recorded races", ""]
    if races:
        history += [f"- {row['date']}: {row['distance_km']:.1f} km in {fmt_duration(row.get('duration_seconds'))} — {row['name']}" for row in races[-12:]]
    else:
        history.append("- No activity is explicitly marked or titled as a race; known PBs remain manual context only.")
    history += [
        "",
        "Training interruptions are represented by zero/low-volume complete weeks. Injury causation is not inferred unless notes or manual feedback explicitly identify it.",
        "",
    ]
    (REPORTS_DIR / "training_history.md").write_text("\n".join(history), encoding="utf-8")

    current = _fitness_section(assessment["fitness"])
    current += ["## Key 3 × 3000 m workout verification", "", "```json", json.dumps(assessment["key_workout"], indent=2), "```", ""]
    current += [
        "## Heart-rate interpretation", "",
        "HR is evaluated with pace, duration, repeat structure, drift, feedback, terrain, and sensor flags. Chest-strap data are considered generally reliable unless the trace is implausible.",
        assessment["fatigue"]["physiological_test_data"],
        "No precise lactate-threshold claim is made from HR alone.", "",
    ]
    (REPORTS_DIR / "current_fitness.md").write_text("\n".join(current), encoding="utf-8")

    complete = [week for week in weeks if date.fromisoformat(week["week_end"]) <= as_of]
    latest_week = complete[-1] if complete else (weeks[-1] if weeks else None)
    weekly = ["# Weekly Review", ""]
    verdict = assessment.get("coach_review", {})
    if latest_week:
        strongest_candidates = [row for row in activities if latest_week["week_start"] <= row["date"] <= latest_week["week_end"]]
        strongest = max(strongest_candidates, key=lambda row: row.get("training_load") or row.get("distance_km") or 0, default=None)
        weekly += [
            f"Week: **{latest_week['week_start']}–{latest_week['week_end']}**", "",
            f"- Weekly mileage: {latest_week['distance_km']:.1f} km",
            f"- Quality volume: {latest_week['quality_session_volume_km']:.1f} km across {latest_week['quality_session_count']} major sessions",
            f"- Long run: {latest_week['longest_run_km']:.1f} km",
            f"- Elevation: {latest_week['elevation_gain_m']:.0f} m",
            f"- Intensity distribution (pace/lap estimate): very easy {latest_week['very_easy_km']:.1f}, easy {latest_week['easy_km']:.1f}, steady {latest_week['steady_km']:.1f}, HM {latest_week['hm_specific_km']:.1f}, threshold {latest_week['threshold_km']:.1f}, faster {latest_week['faster_than_threshold_km']:.1f} km",
            f"- Strongest session: {strongest['date']} — {strongest['name']} ({strongest['workout_type']})" if strongest else "- Strongest session: unavailable",
            f"- Fatigue assessment: {assessment['fatigue']['status']}",
            f"- Non-running recovery context: {assessment['fatigue'].get('cross_training', {}).get('sessions', 0)} sessions; {assessment['fatigue'].get('cross_training', {}).get('training_load', 0):g} load; {assessment['fatigue'].get('cross_training', {}).get('hiking_ascent_m', 0):g} m hiking ascent ({assessment['fatigue'].get('cross_training', {}).get('caution', 'low')} caution)",
            f"- Sub-1:15 trajectory: {assessment['fitness']['goal_feasibility']['rating']}",
            "- Biggest current weakness: " + ("insufficient synchronized evidence" if assessment['fitness']['half_marathon']['likely_range'] == "unavailable" else assessment['fitness']['half_marathon']['evidence_against'][0]),
            "- Next-week priorities: Tuesday primary quality; either Friday economy plus an easy long run, or an easy Friday plus a quality long run; rolling Z2 elevation; one full rest day.", "",
            "## Coach verdict", "",
            f"**{verdict.get('rating', 'unavailable').title()}** — {verdict.get('summary', 'No summary available.')}",
            f"**Next decision:** {verdict.get('decision', 'Review the next sessions against recovery.')}",
            *[f"- {item}" for item in verdict.get("evidence", [])], "",
        ]
    else:
        weekly += ["No complete synchronized week is available yet.", ""]
    (REPORTS_DIR / "weekly_review.md").write_text("\n".join(weekly), encoding="utf-8")

    quality = _load(PROCESSED_DIR.parent / "raw" / "data_quality.json", {})
    strava_quality = _load(PROCESSED_DIR.parent / "raw" / "strava_import_quality.json", {})
    processing_quality = _load(PROCESSED_DIR / "processing_quality.json", {})
    dq = ["# Data Quality", "", f"Last sync: {quality.get('synced_at', 'not run')}", ""]
    for issue in quality.get("issues", []):
        dq.append(f"- {issue.get('activity_id')}: {issue.get('issue')}")
    if not quality.get("issues"):
        dq.append("- No sync issue was recorded (or sync has not run).")
    excluded = processing_quality.get("duplicates_excluded", [])
    dq += [
        "",
        f"- Raw running records: {processing_quality.get('raw_running_records', 'unavailable')}",
        f"- Running records used in analysis after exact-import deduplication: {processing_quality.get('analysis_running_records', 'unavailable')}",
        f"- Exact duplicate imports excluded from metrics: {len(excluded)}",
        f"- Strava rows matched to Intervals and excluded: {strava_quality.get('strava_rows_matched_to_intervals', 0)}",
        f"- Activities absent from Intervals and supplied by the local Strava archive: {strava_quality.get('strava_missing_activities_imported', 0)}",
        f"- Missing-source FIT/TCX/GPX stream files parsed locally: {strava_quality.get('recording_streams_parsed', strava_quality.get('xml_streams_parsed', 0))}",
    ]
    for item in excluded:
        dq.append(
            f"  - {item['date']}: excluded {item['removed_activity_id']}; retained {item['kept_activity_id']} ({item['reason']})."
        )
    dq += ["", "Missing data are not imputed. Stream restrictions and blank wellness fields reduce confidence rather than being invented.", ""]
    (REPORTS_DIR / "data_quality.md").write_text("\n".join(dq), encoding="utf-8")


def analyse(generate_training_plan: bool = False) -> dict[str, Any]:
    settings = get_settings(require_credentials=False)
    activities = process_data()
    all_activities = _load(PROCESSED_ALL_ACTIVITIES_PATH, [])
    wellness = _load(PROCESSED_WELLNESS_PATH, [])
    assessment = build_assessment(activities, wellness, settings.as_of_date, all_activities)
    write_reports(activities, assessment, settings.as_of_date)
    write_advanced_reports(activities, assessment, settings.as_of_date)
    if generate_training_plan:
        plan = generate_plan(assessment, settings.as_of_date)
        write_plan(plan)
        write_dashboard(plan=plan, activities=activities, all_activities=all_activities, assessment=assessment, as_of=settings.as_of_date)
    return assessment


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze synchronized running data")
    parser.add_argument("--plan", action="store_true", help="Also generate the initial daily plan")
    args = parser.parse_args()
    assessment = analyse(generate_training_plan=args.plan)
    print(f"Analysis generated. HM estimate: {assessment['fitness']['half_marathon']['likely_range']}")


if __name__ == "__main__":
    main()
