"""Generic draft-plan generator used by the multi-athlete service.

This generator deliberately produces a reviewable draft. Publishing and athlete
notification remain separate coach-authorized operations in the web platform.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any

from .athlete_context import AthleteContext


@dataclass(frozen=True)
class GeneratedSession:
    date: str
    workout_type: str
    title: str
    details: str
    distance_km: float
    pace_guidance: str
    hr_guidance: str
    purpose: str
    fatigue_modification: str
    major_stimulus: bool = False


@dataclass(frozen=True)
class GeneratedPlan:
    athlete_id: str
    goal_id: str
    start_date: str
    end_date: str
    rationale: str
    requires_coach_review: bool
    sessions: tuple[GeneratedSession, ...]

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["sessions"] = [asdict(session) for session in self.sessions]
        return result


def generate_draft(context: AthleteContext, horizon_days: int = 112) -> GeneratedPlan:
    goal = context.active_goal
    if goal is None:
        raise ValueError("An active goal is required before generating a plan")
    end_date = min(goal.event_date, context.as_of_date + timedelta(days=max(7, horizon_days)))
    target = max(25.0, min(140.0, context.weekly_target_km))
    latest_test = context.latest_test
    goal_pace = (
        round(goal.goal_time_seconds / goal.distance_km)
        if goal.goal_time_seconds and goal.distance_km
        else None
    )
    threshold_pace = latest_test.lt2_pace_seconds_km if latest_test else None
    threshold_hr = latest_test.lt2_hr if latest_test else None
    feedback = context.recent_feedback
    protected_week = bool(str(feedback.get("pain") or "").strip()) or float(feedback.get("fatigue") or 0) >= 8
    sessions: list[GeneratedSession] = []
    cursor = context.as_of_date
    while cursor <= end_date:
        days_to_goal = (goal.event_date - cursor).days
        taper = 0.42 if days_to_goal <= 3 else 0.62 if days_to_goal <= 8 else 0.82 if days_to_goal <= 15 else 1.0
        recovery_override = protected_week and (cursor - context.as_of_date).days < 7
        session = _session_for_day(cursor, target, taper, goal_pace, threshold_pace, threshold_hr, recovery_override)
        if cursor == goal.event_date:
            session = GeneratedSession(
                date=cursor.isoformat(), workout_type="race", title=goal.title,
                details="Race day. Use the pacing and fueling notes approved by the coach.",
                distance_km=float(goal.distance_km or 0),
                pace_guidance=(f"Target rhythm around {_pace(goal_pace)}/km; conditions and execution govern." if goal_pace else "Use the agreed race strategy."),
                hr_guidance="Do not chase heart rate; interpret it with pace, conditions, and effort.",
                purpose="Execute the primary goal event.",
                fatigue_modification="Do not start with illness, focal pain, or unsafe symptoms without appropriate professional advice.",
                major_stimulus=True,
            )
        sessions.append(session)
        cursor += timedelta(days=1)
    source = f"latest LT2 estimate ({_pace(threshold_pace)}/km)" if threshold_pace else f"goal pace ({_pace(goal_pace)}/km)" if goal_pace else "effort guidance"
    rationale = (
        f"{target:.0f} km/week baseline with two controlled stimuli, progressive durability, "
        f"and a race-specific taper. Intensity uses {source}. "
        + ("The opening week is recovery-protected because recent feedback requires review." if protected_week else "This remains a draft until a coach publishes it.")
    )
    return GeneratedPlan(
        athlete_id=context.athlete_id, goal_id=goal.id,
        start_date=context.as_of_date.isoformat(), end_date=end_date.isoformat(),
        rationale=rationale, requires_coach_review=True, sessions=tuple(sessions),
    )


def _session_for_day(day: date, weekly: float, taper: float, goal_pace: int | None, threshold_pace: int | None, threshold_hr: int | None, recovery: bool) -> GeneratedSession:
    distance = lambda share: round(max(0.0, weekly * share * taper) * 2) / 2
    if recovery:
        if day.weekday() in (2, 6):
            return _easy(day, distance(0.12 if day.weekday() == 2 else 0.18), "Recovery run")
        return _rest(day, "Recovery-protected day while feedback is reviewed.")
    weekday = day.weekday()
    if weekday == 0:
        return _rest(day, "Absorb the weekend load and prepare for quality.")
    if weekday == 1:
        pace = threshold_pace or (goal_pace - 3 if goal_pace else None)
        return GeneratedSession(day.isoformat(), "threshold", "Threshold tune-up" if taper < 0.7 else "Controlled threshold intervals", "Warm up; controlled repetitions with easy jog recovery; cool down.", distance(0.19), f"{_pace(pace - 3)}–{_pace(pace + 3)}/km; even repetitions, no final-rep test." if pace else "Controlled threshold effort with one repetition in reserve.", f"Generally below {threshold_hr + 2} bpm late in each repetition." if threshold_hr else "Interpret HR with pace, drift, duration, and feel.", "Develop sustainable speed while keeping the stimulus repeatable.", "Remove one repetition or run easy; never make fewer repetitions faster.", True)
    if weekday == 2:
        return _easy(day, distance(0.12), "Recovery run")
    if weekday == 3:
        return _easy(day, distance(0.15))
    if weekday == 4:
        session = _easy(day, distance(0.15), "Running economy")
        return GeneratedSession(**{**asdict(session), "workout_type": "economy", "details": "Easy running plus relaxed fast repetitions with generous jog recovery.", "pace_guidance": "Fast but relaxed and mechanically clean; never sprint.", "major_stimulus": taper >= 0.7})
    if weekday == 5:
        return _easy(day, distance(0.10), "Short easy run")
    session = _easy(day, distance(0.29), "Long aerobic run")
    return GeneratedSession(**{**asdict(session), "workout_type": "long_run", "details": f"{distance(0.29):g} km easy on terrain appropriate to the goal; no fast finish unless explicitly added.", "purpose": "Aerobic durability and musculoskeletal resilience."})


def _easy(day: date, distance_km: float, title: str = "Easy aerobic run") -> GeneratedSession:
    return GeneratedSession(day.isoformat(), "easy", title, f"{distance_km:g} km genuinely easy on flat to gently rolling terrain.", distance_km, "Conversational effort; slow further for heat, hills, or accumulated fatigue.", "Use HR as a cap and secondary check, not a target.", "Aerobic development and durability without compromising key sessions.", f"Reduce to {max(0, distance_km - 3):g} km or rest if mechanics change or fatigue is abnormal.")


def _rest(day: date, purpose: str) -> GeneratedSession:
    return GeneratedSession(day.isoformat(), "rest", "Rest / mobility", "Rest from running. Optional easy walking and mobility.", 0, "None.", "None.", purpose, "Keep the rest day and address worsening pain rather than cross-training through it.")


def _pace(seconds: int | None) -> str:
    if not seconds:
        return "—"
    return f"{seconds // 60}:{seconds % 60:02d}"
