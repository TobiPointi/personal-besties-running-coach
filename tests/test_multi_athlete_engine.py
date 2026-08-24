from datetime import date
from pathlib import Path

from src.athlete_context import AthleteContext, AthleteWorkspace, Goal, PhysiologicalTest
from src.planning_engine import generate_draft


def test_workspace_paths_are_isolated() -> None:
    workspace_root = Path("isolated-test-workspace")
    first = AthleteWorkspace(workspace_root, "athlete-a")
    second = AthleteWorkspace(workspace_root, "athlete-b")
    assert first.raw_dir != second.raw_dir
    assert first.athlete_root.is_relative_to(workspace_root / "athletes")


def test_generic_plan_uses_athlete_goal_and_test() -> None:
    context = AthleteContext(
        athlete_id="friend-1", display_name="Friend", as_of_date=date(2026, 8, 18), weekly_target_km=60,
        goals=(Goal("race-1", "Autumn Half", date(2026, 9, 27), 21.0975, 5400),),
        tests=(PhysiologicalTest("test-1", date(2026, 8, 1), "5 x 3 min", lt2_pace_seconds_km=245, lt2_hr=174),),
    )
    plan = generate_draft(context)
    assert plan.athlete_id == "friend-1"
    assert plan.requires_coach_review is True
    assert plan.sessions[-1].workout_type == "race"
    assert any(session.workout_type == "threshold" for session in plan.sessions)
    assert "4:05" in plan.rationale


def test_pain_feedback_protects_opening_week() -> None:
    context = AthleteContext(
        athlete_id="friend-2", display_name="Friend", as_of_date=date(2026, 8, 18), weekly_target_km=50,
        goals=(Goal("race-2", "10K", date(2026, 9, 20), 10, 2400),), recent_feedback={"pain": "focal calf pain"},
    )
    plan = generate_draft(context)
    first_week = plan.sessions[:7]
    assert not any(session.major_stimulus for session in first_week)
    assert "recovery-protected" in plan.rationale
