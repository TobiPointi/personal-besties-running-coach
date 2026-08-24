"""Athlete-scoped domain objects for the multi-user coaching platform.

The original HM workflow remains available. New integrations should pass an
explicit AthleteContext so one athlete's paths, goals, tests, or feedback can
never be read accidentally while processing another athlete.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Goal:
    id: str
    title: str
    event_date: date
    distance_km: float | None = None
    goal_time_seconds: int | None = None
    priority: str = "A"
    notes: str = ""


@dataclass(frozen=True)
class PhysiologicalTest:
    id: str
    test_date: date
    protocol: str
    lt1_pace_seconds_km: int | None = None
    lt1_hr: int | None = None
    lt2_pace_seconds_km: int | None = None
    lt2_hr: int | None = None
    confidence: str = "moderate"
    stages: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class AthleteContext:
    athlete_id: str
    display_name: str
    as_of_date: date
    timezone: str = "Europe/Vienna"
    weekly_target_km: float = 50.0
    goals: tuple[Goal, ...] = ()
    tests: tuple[PhysiologicalTest, ...] = ()
    recent_feedback: dict[str, Any] = field(default_factory=dict)
    recent_activities: tuple[dict[str, Any], ...] = ()
    availability: dict[str, Any] = field(default_factory=dict)
    injury_notes: str = ""

    @property
    def active_goal(self) -> Goal | None:
        return min(self.goals, key=lambda goal: (goal.priority, goal.event_date), default=None)

    @property
    def latest_test(self) -> PhysiologicalTest | None:
        return max(self.tests, key=lambda test: test.test_date, default=None)


@dataclass(frozen=True)
class AthleteWorkspace:
    """Optional isolated local workspace used by CLI/backfill workers."""

    root: Path
    athlete_id: str

    @property
    def athlete_root(self) -> Path:
        safe_id = "".join(char for char in self.athlete_id if char.isalnum() or char in "-_")
        if not safe_id:
            raise ValueError("athlete_id must contain a safe character")
        return self.root / "athletes" / safe_id

    @property
    def raw_dir(self) -> Path:
        return self.athlete_root / "raw"

    @property
    def processed_dir(self) -> Path:
        return self.athlete_root / "processed"

    @property
    def plan_dir(self) -> Path:
        return self.athlete_root / "plans"

    def ensure_directories(self) -> None:
        for path in (self.raw_dir, self.processed_dir, self.plan_dir):
            path.mkdir(parents=True, exist_ok=True)
