"""Deployable HTTP wrapper for the athlete-scoped Python planning engine."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.athlete_context import AthleteContext, Goal, PhysiologicalTest
from src.planning_engine import generate_draft


app = FastAPI(title="Athelon coaching engine", version="1.0.0")


class PlanRequest(BaseModel):
    athlete: dict[str, Any]
    goal: dict[str, Any]
    latestTest: dict[str, Any] | None = None
    recentFeedback: dict[str, Any] | None = None
    recentActivities: list[dict[str, Any]] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/plans/generate")
def generate_plan(request: PlanRequest) -> dict[str, Any]:
    try:
        athlete = request.athlete
        goal_data = request.goal
        goal = Goal(
            id=str(goal_data.get("id") or "goal"), title=str(goal_data.get("title") or "Goal event"),
            event_date=date.fromisoformat(str(goal_data.get("event_date") or goal_data.get("eventDate"))),
            distance_km=_number(goal_data.get("distance_km") or goal_data.get("distanceKm")),
            goal_time_seconds=_integer(goal_data.get("goal_time_seconds") or goal_data.get("goalTimeSeconds")),
            priority=str(goal_data.get("priority") or "A"), notes=str(goal_data.get("notes") or ""),
        )
        test = None
        if request.latestTest:
            raw = request.latestTest
            test = PhysiologicalTest(
                id=str(raw.get("id") or "test"), test_date=date.fromisoformat(str(raw.get("test_date") or raw.get("testDate"))),
                protocol=str(raw.get("protocol") or "Lactate test"),
                lt1_pace_seconds_km=_integer(raw.get("lt1_pace_seconds_km") or raw.get("lt1PaceSecondsKm")),
                lt1_hr=_integer(raw.get("lt1_hr") or raw.get("lt1Hr")),
                lt2_pace_seconds_km=_integer(raw.get("lt2_pace_seconds_km") or raw.get("lt2PaceSecondsKm")),
                lt2_hr=_integer(raw.get("lt2_hr") or raw.get("lt2Hr")), confidence=str(raw.get("confidence") or "moderate"),
            )
        context = AthleteContext(
            athlete_id=str(athlete.get("id") or athlete.get("athlete_id")),
            display_name=str(athlete.get("display_name") or athlete.get("displayName") or "Athlete"),
            as_of_date=date.today(), weekly_target_km=float(athlete.get("weekly_target_km") or athlete.get("weeklyTargetKm") or 50),
            goals=(goal,), tests=(test,) if test else (), recent_feedback=request.recentFeedback or {},
            recent_activities=tuple(request.recentActivities),
        )
        result = generate_draft(context).to_dict()
        result["sessions"] = [{"date": row["date"], "workoutType": row["workout_type"], "title": row["title"], "details": row["details"], "distanceKm": row["distance_km"], "paceGuidance": row["pace_guidance"], "hrGuidance": row["hr_guidance"], "purpose": row["purpose"], "fatigueModification": row["fatigue_modification"], "majorStimulus": row["major_stimulus"]} for row in result["sessions"]]
        return {"rationale": result["rationale"], "sessions": result["sessions"]}
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _number(value: Any) -> float | None:
    return float(value) if value not in (None, "") else None


def _integer(value: Any) -> int | None:
    return int(value) if value not in (None, "") else None
