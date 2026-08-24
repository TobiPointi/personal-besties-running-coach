"""One-command sync, reassessment, future-only plan regeneration, and short review."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .analyse import write_reports
from .advanced_analysis import write_advanced_reports
from .coach import CHANGELOG_PATH, compare_plans, generate_plan, reconcile_completed_days, write_plan
from .config import PLAN_PATH, PROCESSED_DIR, REPORTS_DIR, get_settings
from .dashboard import write_dashboard
from .metrics import build_assessment
from .processing import PROCESSED_WELLNESS_PATH, process_data
from .processing import PROCESSED_ALL_ACTIVITIES_PATH
from .sync import sync_data
from .strava_archive import import_archive


def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _completed_since_last_review(activities: list[dict[str, Any]], as_of: date) -> list[dict[str, Any]]:
    state_path = PROCESSED_DIR / "review_state.json"
    state = _load(state_path, {})
    last = state.get("last_review_date")
    if last:
        return [row for row in activities if last <= row.get("date", "") <= as_of.isoformat()]
    return [row for row in activities if row.get("date", "") >= (as_of - timedelta(days=3)).isoformat()]


def _fmt_pace(seconds: float) -> str:
    rounded = round(seconds)
    return f"{rounded // 60}:{rounded % 60:02d}/km"


def _write_latest_review(
    activities: list[dict[str, Any]], assessment: dict[str, Any], plan: dict[str, Any], changes: list[dict[str, Any]], as_of: date
) -> None:
    recent = _completed_since_last_review(activities, as_of)
    future = [
        day for day in plan["days"]
        if day["date"] >= as_of.isoformat() and day.get("status") == "planned"
    ][:3]
    plan_by_date = {day["date"]: day for day in plan["days"]}
    lines = ["# Current Status", "", "## Training completed since last review", ""]
    if recent:
        for row in recent:
            planned = plan_by_date.get(row["date"], {})
            comparison = (
                f"; planned {planned.get('planned_distance_km')} km / {planned.get('workout_type')}"
                if planned else ""
            )
            lines.append(
                f"- {row['date']}: {row['name']} — {row['distance_km']:.1f} km, "
                f"{row['workout_type']}, load {row.get('training_load') or 'n/a'}{comparison}"
            )
    else:
        lines.append("- No newly synchronized run was found.")
    fitness = assessment["fitness"]
    fatigue = assessment["fatigue"]
    cross = fatigue.get("cross_training", {})
    verdict = assessment.get("coach_review", {})
    quality_response = assessment.get("recent_quality_response", {})
    lines += [
        "", "## Fitness signal", "",
        f"Current HM range: **{fitness['half_marathon']['likely_range']}** ({fitness['half_marathon']['confidence']} confidence).",
        f"Conditional race-day range: **{fitness['goal_feasibility'].get('conditional_race_day_range', 'unavailable')}**.",
        "", "## Coach verdict", "",
        f"**{verdict.get('rating', 'unavailable').title()}** — {verdict.get('summary', 'No summary available.')}",
        f"**Next decision:** {verdict.get('decision', 'Review the next sessions against recovery.')}",
        *[f"- {item}" for item in verdict.get("evidence", [])],
        "", "## Latest quality-session assessment", "",
    ]
    if quality_response.get("date"):
        paces = ", ".join(_fmt_pace(float(value)) for value in quality_response.get("rep_paces_seconds_per_km", []))
        hrs = ", ".join(str(round(float(value))) for value in quality_response.get("rep_average_hr", []))
        drops = ", ".join(str(round(float(value))) for value in quality_response.get("recovery_hr_drops", []))
        lines += [
            f"{quality_response.get('date')}: **{quality_response.get('activity_name', 'quality session')}** — {quality_response.get('work_km', 0):g} km detected work.",
            f"- Rep pace: {paces or 'unavailable'}",
            f"- Rep average HR: {hrs or 'unavailable'} bpm; raw sample maximum: {quality_response.get('rep_max_hr', 'unavailable')} bpm; final-rep 20 s HR: {quality_response.get('final_rep_end_hr_20s', 'unavailable')} bpm.",
            f"- Recovery HR drops: {drops or 'unavailable'} bpm. Evaluate rep HR against pace/structure; whole-activity drift is not used for an interval workout.",
            f"- Coach interpretation: {quality_response.get('summary', 'No session interpretation available.')}",
        ]
    else:
        lines.append("No recent multi-repetition session is available for detailed pace/HR comparison.")
    lines += [
        "", "## Fatigue/recovery signal", "",
        f"Status: **{fatigue['status']}**. " + ("; ".join(fatigue["warnings"]) if fatigue["warnings"] else "No strong warning in the available fields; missing wellness still limits certainty."),
        f"Recent non-running context: {cross.get('sessions', 0)} sessions, {cross.get('training_load', 0):g} load, {cross.get('duration_hours', 0):g} h, {cross.get('hiking_ascent_m', 0):g} m hiking ascent (caution: {cross.get('caution', 'low')}).",
        "", f"Goal trajectory: **sub-1:15 confidence = {fitness['goal_feasibility']['rating']}**", "",
        "# Next 3 Days", "",
    ]
    for day in future:
        lines += [
            f"## {day['day']} — {day['date']}", "",
            f"**{day['workout_type']} — {day['planned_distance_km']:g} km.** {day['details']}",
            f"Purpose: {day['purpose']}",
            f"If fatigued: {day['fatigue_modification']}", "",
        ]
    lines += ["# Changes to Plan", ""]
    if changes:
        for change in changes[:12]:
            lines += [
                f"## PLAN CHANGE — {as_of.strftime('%d %b')}", "",
                f"Date: {change['date']}", "",
                f"Original: {change['original']}", "",
                f"Updated: {change['updated']}", "",
                "Reason: Recalculated from newly synchronized completion, recent volume, performance signals, fatigue/wellness, and missed or changed sessions.", "",
            ]
    else:
        lines += ["None. The next sessions remain appropriate given the evidence currently available.", ""]
    (REPORTS_DIR / "latest_review.md").write_text("\n".join(lines), encoding="utf-8")


def _append_changelog(changes: list[dict[str, Any]], as_of: date) -> None:
    if not changes:
        return
    existing = CHANGELOG_PATH.read_text(encoding="utf-8") if CHANGELOG_PATH.exists() else "# Plan Change Log\n\n"
    block = [f"## PLAN CHANGE — {as_of.strftime('%d %b %Y')}", ""]
    for change in changes:
        block += [
            f"### {change['date']}", "",
            f"- Original: {change['original']}",
            f"- Updated: {change['updated']}",
            "- Reason: Recalculated from actual completion, load, fitness and fatigue signals.", "",
        ]
    CHANGELOG_PATH.write_text(existing + "\n".join(block), encoding="utf-8")


def update(full_sync: bool = False, skip_sync: bool = False) -> dict[str, Any]:
    settings = get_settings(require_credentials=not skip_sync)
    if not skip_sync:
        sync_data(settings, full=full_sync)
        if settings.strava_archive_path and settings.strava_archive_path.exists():
            oldest = settings.as_of_date - timedelta(days=round(settings.history_months * 30.4375))
            import_archive(settings.strava_archive_path, oldest, settings.as_of_date)
    activities = process_data()
    all_activities = _load(PROCESSED_ALL_ACTIVITIES_PATH, [])
    wellness = _load(PROCESSED_WELLNESS_PATH, [])
    assessment = build_assessment(activities, wellness, settings.as_of_date, all_activities)
    write_reports(activities, assessment, settings.as_of_date)
    write_advanced_reports(activities, assessment, settings.as_of_date)
    old_plan = reconcile_completed_days(_load(PLAN_PATH, None), activities, settings.as_of_date)
    completed_dates = {
        row["date"] for row in activities
        if row.get("date") and row["date"] <= settings.as_of_date.isoformat()
    }
    new_plan = generate_plan(
        assessment,
        settings.as_of_date,
        existing=old_plan,
        completed_activity_dates=completed_dates,
    )
    changes = compare_plans(old_plan, new_plan, settings.as_of_date)
    if changes:
        entry = {
            "changed_at": datetime.now(timezone.utc).isoformat(),
            "effective_date": settings.as_of_date.isoformat(),
            "changes": changes,
            "reason": "New synchronized training and recovery assessment.",
        }
        new_plan["change_log"] = list(old_plan.get("change_log", [])) + [entry] if old_plan else [entry]
    write_plan(new_plan)
    write_dashboard(plan=new_plan, activities=activities, all_activities=all_activities, assessment=assessment, as_of=settings.as_of_date)
    _write_latest_review(activities, assessment, new_plan, changes, settings.as_of_date)
    _append_changelog(changes, settings.as_of_date)
    (PROCESSED_DIR / "review_state.json").write_text(
        json.dumps({"last_review_date": settings.as_of_date.isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}, indent=2),
        encoding="utf-8",
    )
    return {"assessment": assessment, "changes": changes}


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync, reassess, and update only the future HM plan")
    parser.add_argument("--full-sync", action="store_true")
    parser.add_argument("--skip-sync", action="store_true", help="Offline/testing only: use the current local cache")
    args = parser.parse_args()
    result = update(full_sync=args.full_sync, skip_sync=args.skip_sync)
    print(f"Update complete. Future plan changes: {len(result['changes'])}.")
    print("Open reports/training_dashboard.html, reports/latest_review.md and reports/bad_ischl_plan.md")


if __name__ == "__main__":
    main()
