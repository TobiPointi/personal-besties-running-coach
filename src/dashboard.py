"""Create a private, static training dashboard and offline calendar export.

This module intentionally has no remote API calls.  It turns the current local
assessment, completed activities and future-only plan into files that can be
opened on the computer or imported into a normal calendar application.
"""

from __future__ import annotations

import argparse
import html
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import PLAN_DIR, PLAN_PATH, PROCESSED_DIR, REPORTS_DIR, get_settings
from .processing import PROCESSED_ACTIVITIES_PATH, PROCESSED_ALL_ACTIVITIES_PATH


DASHBOARD_PATH = REPORTS_DIR / "training_dashboard.html"
CALENDAR_PATH = PLAN_DIR / "bad_ischl_calendar.ics"
SUUNTO_SHEET_PATH = PLAN_DIR / "suunto_key_workouts.md"
ASSESSMENT_PATH = PROCESSED_DIR / "assessment.json"


def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _week_start(value: str) -> str:
    day = date.fromisoformat(value)
    return (day.fromordinal(day.toordinal() - day.weekday())).isoformat()


def _ics_escape(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def calendar_text(plan: dict[str, Any], as_of: date) -> str:
    """Return an all-day calendar containing only the uncompleted future plan."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Local Running Coach//Bad Ischl HM//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Bad Ischl HM plan (local)",
    ]
    for item in plan.get("days", []):
        if item.get("date", "") < as_of.isoformat() or item.get("status") != "planned":
            continue
        km = item.get("planned_distance_km", 0)
        summary = f"{item.get('workout_type', 'run').title()} — {km:g} km"
        description = "\n".join(
            [
                item.get("details", ""),
                f"Pace: {item.get('pace_guidance', '')}",
                f"HR: {item.get('hr_guidance', '')}",
                f"Recovery: {item.get('recovery', '')}",
                f"Terrain: {item.get('terrain_elevation', '')}",
                f"Purpose: {item.get('purpose', '')}",
                f"If fatigued: {item.get('fatigue_modification', '')}",
            ]
        )
        lines += [
            "BEGIN:VEVENT",
            f"UID:bad-ischl-{item['date']}@local-running-coach",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{item['date'].replace('-', '')}",
            f"SUMMARY:{_ics_escape(summary)}",
            f"DESCRIPTION:{_ics_escape(description)}",
            f"CATEGORIES:RUNNING,{_ics_escape(item.get('workout_type', 'run').upper())}",
            "STATUS:CONFIRMED",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _completed_by_week(activities: list[dict[str, Any]], as_of: date) -> dict[str, float]:
    result: dict[str, float] = defaultdict(float)
    for row in activities:
        if row.get("date", "") <= as_of.isoformat() and row.get("date"):
            result[_week_start(row["date"])] += float(row.get("distance_km") or 0)
    return result


def _weekly_rows(plan: dict[str, Any], activities: list[dict[str, Any]], as_of: date) -> list[tuple[str, float, float]]:
    planned: dict[str, float] = defaultdict(float)
    for item in plan.get("days", []):
        planned[_week_start(item["date"])] += float(item.get("planned_distance_km") or 0)
    actual = _completed_by_week(activities, as_of)
    weeks = sorted(set(planned) | set(actual))
    return [(week, actual.get(week, 0), planned.get(week, 0)) for week in weeks]


def _bar(value: float, maximum: float, color: str) -> str:
    width = 0 if not maximum else value / maximum * 100
    return f'<span class="bar"><span style="width:{width:.1f}%;background:{color}"></span></span>'


def _fmt_duration(seconds: Any) -> str:
    try:
        seconds = int(float(seconds))
    except (TypeError, ValueError):
        return "—"
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}"


def _dashboard_html(
    plan: dict[str, Any], running_activities: list[dict[str, Any]], all_activities: list[dict[str, Any]], assessment: dict[str, Any], as_of: date
) -> str:
    fitness = assessment.get("fitness", {})
    hm = fitness.get("half_marathon", {})
    feasibility = fitness.get("goal_feasibility", {})
    fatigue = assessment.get("fatigue", {})
    cross = fatigue.get("cross_training", {})
    future = [item for item in plan.get("days", []) if item.get("date", "") >= as_of.isoformat() and item.get("status") == "planned"]
    start_recent = (as_of - timedelta(days=13)).isoformat()
    recent = [row for row in running_activities if as_of.isoformat() >= row.get("date", "") >= start_recent]
    recent_all = [row for row in all_activities if as_of.isoformat() >= row.get("date", "") >= start_recent]
    weekly = _weekly_rows(plan, running_activities, as_of)
    maximum = max((max(actual, planned) for _, actual, planned in weekly), default=1)

    upcoming_rows = "".join(
        ("<tr class=\"major\">" if item.get("major_stimulus") else "<tr>")
        + f"<td>{html.escape(item.get('day', ''))}<br><small>{item['date']}</small></td>"
        + f"<td><strong>{html.escape(item.get('workout_type', ''))}</strong><br>{item.get('planned_distance_km', 0):g} km</td>"
        + f"<td>{html.escape(item.get('details', ''))}<br><small>{html.escape(item.get('purpose', ''))}</small></td></tr>"
        for item in future[:14]
    ) or "<tr><td colspan=\"3\">No future planned days found.</td></tr>"
    recent_rows = "".join(
        f"<tr><td>{html.escape(row.get('date', ''))}</td><td>{html.escape(row.get('workout_type', ''))}</td>"
        f"<td>{float(row.get('distance_km') or 0):.1f} km</td><td>{html.escape(str(row.get('name', '')))}</td></tr>"
        for row in sorted(recent, key=lambda row: row.get("date", ""), reverse=True)
    ) or "<tr><td colspan=\"4\">No running activity in the last 14 days.</td></tr>"
    all_activity_rows = "".join(
        f"<tr><td>{html.escape(row.get('date', ''))}</td><td>{html.escape(str(row.get('type') or 'Other'))}</td>"
        f"<td>{float(row.get('distance_km') or 0):.1f} km</td><td>{_fmt_duration(row.get('duration_seconds'))}</td>"
        f"<td>{float(row.get('elevation_gain_m') or 0):.0f} m</td><td>{html.escape(str(row.get('name', '')))}</td></tr>"
        for row in sorted(recent_all, key=lambda row: (row.get("date", ""), row.get("start_date_local") or ""), reverse=True)
    ) or "<tr><td colspan=\"6\">No synchronized activity in the last 14 days.</td></tr>"
    weekly_rows = "".join(
        f"<tr><td>{week}</td><td>{actual:.1f} km {_bar(actual, maximum, '#2d7dd2')}</td>"
        f"<td>{planned:.1f} km {_bar(planned, maximum, '#f4a261')}</td></tr>"
        for week, actual, planned in weekly
    )
    generated = html.escape(plan.get("generated_at", "unknown"))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bad Ischl HM — Training dashboard</title>
<style>
body{{font:16px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#17202a;background:#f5f7fa;margin:0}} main{{max-width:1120px;margin:auto;padding:28px 18px 48px}} h1{{margin-bottom:4px}} .muted,small{{color:#617080}} .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:20px 0}} .card{{background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 3px #0001}} .card b{{font-size:1.25rem;display:block;margin-top:4px}} section{{background:#fff;border-radius:10px;padding:18px;margin:16px 0;box-shadow:0 1px 3px #0001}} table{{border-collapse:collapse;width:100%}} td,th{{padding:10px 8px;border-bottom:1px solid #e5e9ee;vertical-align:top;text-align:left}} .major{{background:#fff8e8}} .bar{{display:inline-block;width:90px;height:8px;background:#e9eef3;border-radius:4px;overflow:hidden;margin-left:7px}} .bar span{{display:block;height:100%}} a{{color:#155e9b}} @media(max-width:640px){{td,th{{padding:7px 4px}} table{{font-size:.88rem}}}}
</style></head><body><main>
<h1>Bad Ischl Half Marathon — training dashboard</h1><p class="muted">Local plan control centre. Data current through {as_of.isoformat()}; dashboard generated {generated}. This page makes no changes to Intervals.icu, Suunto, or Strava.</p>
<div class="cards"><div class="card">Current HM estimate<b>{html.escape(hm.get('likely_range', 'unavailable'))}</b><span>{html.escape(hm.get('confidence', ''))} confidence</span></div><div class="card">Race-day forecast<b>{html.escape(feasibility.get('conditional_race_day_range', 'unavailable'))}</b><span>conditional on taper, weather and execution</span></div><div class="card">Sub-1:15 trajectory<b>{html.escape(feasibility.get('rating', 'unavailable'))}</b><span>{html.escape(feasibility.get('confidence', ''))} evidence quality</span></div><div class="card">Recovery signal<b>{html.escape(fatigue.get('status', 'unavailable'))}</b><span>Use this with your own legs/pain feedback</span></div><div class="card">Non-running load (7 days)<b>{cross.get('training_load', 0):g} load / {cross.get('duration_hours', 0):g} h</b><span>{cross.get('hiking_ascent_m', 0):g} m hike ascent; {html.escape(cross.get('caution', 'low'))} caution</span></div></div>
<section><h2>Next 14 days</h2><p>Gold rows are the two major weekly stimuli. Use the fatigue alternative written in the full plan if recovery changes.</p><table><thead><tr><th>Day</th><th>Session</th><th>Workout and purpose</th></tr></thead><tbody>{upcoming_rows}</tbody></table></section>
<section><h2>Completed running — last 14 days</h2><table><thead><tr><th>Date</th><th>Classification</th><th>Distance</th><th>Activity</th></tr></thead><tbody>{recent_rows}</tbody></table></section>
<section><h2>All completed activities — last 14 days</h2><p class="muted">Hikes, rides, strength, and other sessions inform recovery/load context but do not count toward running mileage.</p><table><thead><tr><th>Date</th><th>Type</th><th>Distance</th><th>Duration</th><th>Ascent</th><th>Activity</th></tr></thead><tbody>{all_activity_rows}</tbody></table></section>
<section><h2>Weekly running volume</h2><p class="muted">Blue = completed locally synchronized running; orange = current plan. A partial present week is expected to differ.</p><table><thead><tr><th>Week of</th><th>Completed</th><th>Plan</th></tr></thead><tbody>{weekly_rows}</tbody></table></section>
<section><h2>Use this system</h2><ol><li>Run <code>python -m src.update_plan</code> every 1–3 days.</li><li>Open this page, then <a href="latest_review.md">latest review</a> for the decision and <a href="bad_ischl_plan.md">full daily plan</a> for detail.</li><li>Import <code>../plan/bad_ischl_calendar.ics</code> into your personal calendar after an update; replace the previous imported calendar to avoid duplicates.</li><li>Create only the next key sessions manually in Suunto from <code>../plan/suunto_key_workouts.md</code>; the rest remains flexible by terrain and fatigue.</li></ol></section>
</main></body></html>"""


def write_dashboard(
    plan: dict[str, Any] | None = None,
    activities: list[dict[str, Any]] | None = None,
    all_activities: list[dict[str, Any]] | None = None,
    assessment: dict[str, Any] | None = None,
    as_of: date | None = None,
) -> tuple[Path, Path, Path]:
    """Write dashboard, calendar and manual Suunto key-workout sheet."""
    settings = get_settings(require_credentials=False)
    as_of = as_of or settings.as_of_date
    plan = plan or _load(PLAN_PATH, {})
    activities = activities if activities is not None else _load(PROCESSED_ACTIVITIES_PATH, [])
    all_activities = all_activities if all_activities is not None else _load(PROCESSED_ALL_ACTIVITIES_PATH, [])
    assessment = assessment or _load(ASSESSMENT_PATH, {})
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PLAN_DIR.mkdir(parents=True, exist_ok=True)
    DASHBOARD_PATH.write_text(_dashboard_html(plan, activities, all_activities, assessment, as_of), encoding="utf-8")
    CALENDAR_PATH.write_text(calendar_text(plan, as_of), encoding="utf-8", newline="")
    key = ["# Suunto key-workout entry sheet", "", "Create only these major planned sessions in the Suunto app, then sync the watch. Copy the workout structure exactly; keep easy and long runs guided by the plan rather than over-programmed.", ""]
    for item in plan.get("days", []):
        if item.get("date", "") >= as_of.isoformat() and item.get("status") == "planned" and item.get("major_stimulus"):
            key += [f"## {item['day']} — {item['date']} — {item['workout_type']}", "", f"- Planned: {item.get('planned_distance_km', 0):g} km", f"- Structure: {item.get('details', '')}", f"- Pace: {item.get('pace_guidance', '')}", f"- Recovery: {item.get('recovery', '')}", f"- Purpose: {item.get('purpose', '')}", f"- If fatigued: {item.get('fatigue_modification', '')}", ""]
    SUUNTO_SHEET_PATH.write_text("\n".join(key), encoding="utf-8")
    return DASHBOARD_PATH, CALENDAR_PATH, SUUNTO_SHEET_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Create local dashboard and calendar from the current plan")
    parser.parse_args()
    paths = write_dashboard()
    print("Created: " + ", ".join(str(path) for path in paths))


if __name__ == "__main__":
    main()
