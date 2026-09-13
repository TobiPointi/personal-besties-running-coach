"""Generate a conservative, race-specific, fully daily and adaptive HM plan."""

from __future__ import annotations

import copy
import json
import math
import statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import ATHLETE_PROFILE_PATH, GOAL_PACE_SECONDS_PER_KM, PLAN_PATH, RACE_DATE, REPORTS_DIR
from .metrics import fmt_duration, fmt_pace


PLAN_MD_PATH = REPORTS_DIR / "bad_ischl_plan.md"
CHANGELOG_PATH = REPORTS_DIR / "plan_changelog.md"


def load_profile() -> dict[str, Any]:
    return json.loads(ATHLETE_PROFILE_PATH.read_text(encoding="utf-8"))


def _day_template(day: date, **kwargs: Any) -> dict[str, Any]:
    base = {
        "date": day.isoformat(),
        "day": day.strftime("%A"),
        "status": "planned",
        "planned_distance_km": 0.0,
        "planned_duration_minutes": None,
        "workout_type": "rest",
        "details": "Rest from running. Optional easy walk and mobility.",
        "pace_guidance": "None.",
        "hr_guidance": "None.",
        "recovery": "Full recovery day.",
        "terrain_elevation": "Flat/none.",
        "purpose": "Absorb training and preserve quality for the next key stimulus.",
        "fatigue_modification": "Keep the rest day; address any pain rather than cross-training through it.",
        "strength": None,
        "major_stimulus": False,
    }
    base.update(kwargs)
    return base


def _weekly_target(assessment: dict[str, Any]) -> tuple[float, str]:
    as_of = date.fromisoformat(assessment["as_of_date"])
    completed_weeks = [
        week for week in assessment.get("recent_weeks", [])
        if date.fromisoformat(week["week_end"]) <= as_of and week.get("distance_km")
    ]
    recent = [week["distance_km"] for week in completed_weeks[-8:]]
    avg = statistics.mean(recent) if recent else 0.0
    median = statistics.median(recent) if recent else 0.0
    peak = max(recent, default=0.0)
    if avg <= 0:
        return 0.0, "No synchronized mileage basis is available; only a conservative provisional plan can be generated."
    rolling_7 = float(assessment.get("rolling_volume", {}).get("rolling_7_km") or 0)
    sustainable = min(peak, max(avg * 1.08, median * 1.06, rolling_7))
    return (
        round(sustainable, 1),
        f"Recent complete-week mean {avg:.1f} km, median {median:.1f} km, "
        f"rolling 7 days {rolling_7:.1f} km, recent peak {peak:.1f} km.",
    )


def _base_easy(day: date, km: float, rolling: bool = False) -> dict[str, Any]:
    return _day_template(
        day,
        planned_distance_km=round(km, 1),
        workout_type="easy",
        details=f"{km:.0f} km genuinely easy. Finish with 6 × 12–15 s relaxed strides only if fresh.",
        pace_guidance="Conversational effort; typically 4:25–5:05/km, but slow further for heat, hills, or fatigue.",
        hr_guidance="Use HR as a cap/secondary check, not a target. No threshold inference from HR alone.",
        recovery="60–90 s walk/jog between optional strides.",
        terrain_elevation="Rolling terrain (roughly 100–250 m gain) is welcome." if rolling else "Flat to gently rolling.",
        purpose="Aerobic volume and musculoskeletal durability without compromising key sessions.",
        fatigue_modification=f"Reduce to {max(5, km-3):.0f} km or take rest if fatigue is abnormal.",
    )


def _recovery(day: date, km: float) -> dict[str, Any]:
    result = _base_easy(day, km)
    result.update(
        workout_type="recovery",
        details=f"{km:.0f} km very easy; no pace objective.",
        pace_guidance="Usually 4:45–5:30/km or slower; breathing and legs must remain easy.",
        terrain_elevation="Flat/gentle; avoid technical descents.",
        purpose="Restore movement and circulation while absorbing the previous hard day.",
        fatigue_modification="Rest instead if soreness changes mechanics or pain is focal/worsening.",
    )
    return result


def _quality(day: date, spec: dict[str, Any], scale: float = 1.0) -> dict[str, Any]:
    km = round(float(spec["distance_km"]), 1)
    return _day_template(
        day,
        planned_distance_km=km,
        workout_type=spec["type"],
        details=spec["details"],
        pace_guidance=spec["pace"],
        hr_guidance=spec.get("hr", "Let HR rise naturally; interpret it with pace, duration, drift, and feel."),
        recovery=spec["recovery"],
        terrain_elevation=spec.get("terrain", "Flat, accurately measured route with minimal interruptions."),
        purpose=spec["purpose"],
        fatigue_modification=spec["fatigue"],
        strength=spec.get("strength"),
        major_stimulus=spec.get("major_stimulus", True),
    )


PRIMARY_SESSIONS = {
    date(2026, 8, 18): {
        "type": "threshold",
        "distance_km": 15,
        "details": "3 km easy; drills + 4 strides; 4 × 2 km @ controlled threshold; 75–90 s easy jog; 2–3 km cool-down.",
        "pace": "3:27–3:31/km. Keep rep 1 deliberately controlled and all four even; do not make the final rep a test.",
        "recovery": "75–90 s easy jog after each 2 km rep.",
        "purpose": "Maintain strong threshold volume with shorter recovery than the 3 × 3 km session, without forcing 10 km of work six days later.",
        "fatigue": "Do 3 × 2 km if warm-up feel/HR is abnormal; never make fewer reps faster.",
        "strength": "Later the same day: 25–30 min low-volume strength—split squat, RDL, straight- and bent-knee calf work, hip stability and trunk; 2–3 sets, 2–3 reps in reserve.",
    },
    date(2026, 8, 25): {
        "type": "HM-specific",
        "distance_km": 15,
        "details": "3 km easy; drills + strides; 2 × 4 km @ HM effort; 2:00 easy jog; 3 km cool-down.",
        "pace": "3:31–3:34/km in normal conditions; effort governs in wind/heat.",
        "recovery": "2:00 easy jog between 4 km blocks.",
        "purpose": "Extend time near goal intensity without excessive anaerobic contribution.",
        "fatigue": "Change to 3 × 2 km at the same effort with 90 s jog, or run easy if fatigue is elevated.",
        "strength": "Later the same day: 25–30 min low-volume running strength; avoid grinding repetitions or DOMS.",
    },
    date(2026, 9, 1): {
        "type": "threshold",
        "distance_km": 15,
        "details": "3 km easy; drills + strides; 3 × 3 km @ controlled threshold/HM crossover; 90 s easy jog; 2–3 km cool-down.",
        "pace": "3:29–3:32/km; smooth, with no faster final rep unless effort remains clearly controlled.",
        "recovery": "90 s easy jog between 3 km reps.",
        "purpose": "Raise sustainable speed while keeping the stimulus specific and repeatable.",
        "fatigue": "Stop after 2 reps if pace requires straining; add easy cool-down instead.",
        "strength": "Later the same day: 25 min low-volume running strength, leaving 2–3 reps in reserve.",
    },
    date(2026, 9, 8): {
        "type": "HM-specific",
        "distance_km": 16,
        "details": "3 km easy; drills + strides; 2 × 5 km @ HM effort; 2:00 easy jog; 3 km cool-down.",
        "pace": "3:31–3:34/km; prioritize even effort and a relaxed first block.",
        "recovery": "2:00 easy jog between 5 km blocks.",
        "purpose": "Build race-specific endurance through longer controlled blocks.",
        "fatigue": "Run 2 × 4 km instead; never compensate by running the shorter version faster.",
        "strength": "Final normal strength session later the same day: 20–25 min, low volume, no DOMS.",
    },
    date(2026, 9, 15): {
        "type": "HM-specific",
        "distance_km": 14,
        "details": "3 km easy; drills + strides; 8 km continuous at controlled HM-specific effort; 3 km cool-down.",
        "pace": "Begin 3:34–3:35/km and only settle toward 3:31–3:33/km if controlled. This is not a time trial.",
        "recovery": "Continuous specific block; no standing recovery.",
        "purpose": "Convert broken HM work into continuous race rhythm without carrying excessive fatigue into the taper.",
        "fatigue": "Use 2 × 4 km with 2 min jog if continuous work would become a test; stop if mechanics deteriorate.",
        "strength": "Optional 15–20 min maintenance only: calf/soleus, hip stability and trunk; no heavy eccentric work.",
    },
    date(2026, 9, 22): {
        "type": "HM-specific tune-up",
        "distance_km": 12,
        "details": "3 km easy; drills + strides; 3 × 2 km @ goal HM pace; 2:00 easy jog; 2 km cool-down.",
        "pace": "3:32–3:34/km. Exact rhythm, never faster than 3:30/km.",
        "recovery": "2:00 easy jog.",
        "purpose": "Rehearse goal rhythm while reducing total load in race week.",
        "fatigue": "Do 2 × 2 km, or 4 × 3 min at HM effort if travel/fatigue warrants.",
    },
}


SECONDARY_FRIDAYS = {
    date(2026, 8, 21): {
        "type": "running economy",
        "distance_km": 12,
        "details": "3 km easy; drills + 4 strides; 10 × 400 m controlled fast with 200 m easy jog; 2 km cool-down.",
        "pace": "78–80 s per 400 m (3:15–3:20/km). Relaxed 5K rhythm, never sprinting.",
        "recovery": "200 m easy jog, normally 65–80 s; begin each rep composed.",
        "purpose": "Maintain speed reserve and economy with only 4 km of fast running, leaving Sunday’s long run aerobic.",
        "fatigue": "Replace with 8–10 km easy plus 6 strides. If skipped for fatigue, keep Sunday entirely easy.",
    },
    date(2026, 9, 4): {
        "type": "10K-specific maintenance",
        "distance_km": 13,
        "details": "3 km easy; drills + strides; 6 × 1 km controlled at current 10K effort; 75 s easy jog; 2–3 km cool-down.",
        "pace": "3:23–3:27/km. Even reps; stop before strain and do not chase a faster sixth repetition.",
        "recovery": "75 s easy jog after each 1 km rep.",
        "purpose": "Maintain aerobic power and speed reserve while Tuesday carries the larger threshold stimulus.",
        "fatigue": "Do 4 × 1 km or replace with 10 km easy plus strides. Sunday then remains easy, not compensatory.",
    },
    date(2026, 9, 18): {
        "type": "running economy",
        "distance_km": 11,
        "details": "3 km easy; drills + strides; 8 × 400 m controlled fast with 200 m easy jog; 2 km cool-down.",
        "pace": "78–80 s per 400 m (3:15–3:20/km), relaxed and mechanically clean.",
        "recovery": "200 m easy jog; full control matters more than short recovery.",
        "purpose": "Preserve economy and leg speed while overall volume and fatigue begin to fall.",
        "fatigue": "Run 8–10 km easy with 6 × 15 s strides instead; do not force the session during the taper.",
    },
}


STRIDE_FRIDAYS = {
    date(2026, 8, 28): 10,
    date(2026, 9, 11): 10,
    date(2026, 9, 25): 7,
}


POST_QUALITY_LONG_RECOVERY = {
    date(2026, 8, 30): 8,
    date(2026, 9, 13): 8,
}


# Athlete-specific late-taper adjustment. The Udine–Brenner bike transfer
# (6–10 Sep) supplied substantial aerobic work but also 17.5 h / 228 load of
# non-running stress. The Danube Canal Relays on 11 Sep then supplied the
# final long HM-specific stimulus. The 5 km Vienna Night Run is deliberately
# used as a controlled B-race, replacing rather than supplementing 400 m work.
SPECIAL_TAPER_DAYS = {
    date(2026, 9, 12): {
        "workout_type": "rest",
        "details": "Full non-running recovery day after the bike transfer and Friday relay session. Optional walking and 10–15 min gentle mobility only.",
        "pace_guidance": "None.", "hr_guidance": "None.", "recovery": "Full recovery day.", "terrain_elevation": "Flat/none.",
        "purpose": "Absorb accumulated cycling and running load; no missed mileage is made up.",
        "fatigue_modification": "Keep this as rest if legs are heavy, sleep is poor, or any soreness alters mechanics.",
    },
    date(2026, 9, 13): {
        "planned_distance_km": 14, "workout_type": "easy endurance",
        "details": "14 km genuinely easy and mostly flat; no strides, hills, fast finish, or pace objective.",
        "pace_guidance": "4:40–5:20/km or slower by feel; keep breathing clearly easy.", "hr_guidance": "Use HR only as a cap/secondary check.",
        "recovery": "No structured recovery.", "terrain_elevation": "Flat to gently rolling, under 150 m ascent.",
        "purpose": "Retain running endurance 14 days before the HM without turning a tired-quads day into another stimulus.",
        "fatigue_modification": "Reduce to 8–10 km or rest if stiffness changes mechanics, pain is focal, or the stride does not loosen after 10 minutes.",
    },
    date(2026, 9, 15): {
        "planned_distance_km": 11, "workout_type": "HM-specific primer",
        "details": "3 km easy; drills + 4 strides; 2 × 2 km at controlled HM effort with 1 km easy jog; 3 km cool-down.",
        "pace_guidance": "3:33–3:35/km. This is a rhythm check after Friday's 4 × 2 km session, not a test or a substitute for missed 2 × 5 km work.",
        "hr_guidance": "Let HR rise naturally; stop after one rep if the warm-up or first block feels laboured.",
        "recovery": "1 km genuinely easy jog between the 2 km blocks.", "terrain_elevation": "Flat, accurately measured route with minimal interruptions.",
        "purpose": "Re-establish goal-HM rhythm before the Night Run without stacking a second maximal session.",
        "fatigue_modification": "Use 1 × 2 km at HM effort, or run 8–10 km easy, if legs remain loaded.", "major_stimulus": False,
    },
    date(2026, 9, 16): {
        "planned_distance_km": 7, "workout_type": "recovery", "details": "7 km very easy, flat recovery; no strides.",
        "pace_guidance": "4:50–5:30/km or slower by feel.", "hr_guidance": "Use HR only as a cap/secondary check.",
        "recovery": "No structured recovery.", "terrain_elevation": "Flat/gentle; avoid hard descents.",
        "purpose": "Arrive fresh for Thursday rather than accumulating mileage.", "fatigue_modification": "Rest if legs are not springy.",
    },
    date(2026, 9, 17): {
        "planned_distance_km": 9, "workout_type": "Vienna Night Run — controlled 5 km B-race",
        "details": "2 km warm-up; drills + 4 strides; 5 km Vienna Night Run; 2 km cool-down if convenient. Run it progressively: first km 3:25–3:27/km, km 2–4 at 3:20–3:22/km, then hold form through the final km without a finishing sprint.",
        "pace_guidance": "Target 16:40–16:55: approximately 97–98% effort, hard but below an all-out PB attempt.",
        "hr_guidance": "Race HR is observational only. Control the first kilometre; effort is about 9/10, not a final-kilometre sprint.",
        "recovery": "No interval recovery. Rehydrate and refuel after the evening event.", "terrain_elevation": "Vienna Ringstraße 5 km circuit; allow for start congestion and bends.",
        "purpose": "A sanctioned sharpening stimulus that replaces the planned 400 m economy session.",
        "fatigue_modification": "If Tuesday was laboured or legs remain heavy, run 17:05–17:15 with no final-kilometre push, or jog the event socially.", "major_stimulus": True,
    },
    date(2026, 9, 18): {
        "workout_type": "rest", "details": "Full rest from running after the Night Run. Optional walking and gentle mobility only.",
        "pace_guidance": "None.", "hr_guidance": "None.", "recovery": "Full recovery day.", "terrain_elevation": "Flat/none.",
        "purpose": "Absorb the B-race and protect the final HM taper.", "fatigue_modification": "Keep the rest day; do not add the former 400 m session.",
    },
    date(2026, 9, 20): {
        "planned_distance_km": 14, "workout_type": "long run", "details": "14 km relaxed and mostly flat; no progression, fast finish, or hard descending.",
        "pace_guidance": "4:25–5:10/km by feel; keep it fully aerobic.", "hr_guidance": "Use HR as a secondary check with pace and feel.",
        "recovery": "No structured recovery.", "terrain_elevation": "Flat to gently rolling, approximately 100–200 m ascent.",
        "purpose": "Maintain running durability while allowing Night Run fatigue to clear.", "fatigue_modification": "Reduce to 10–12 km easy if Thursday cost more than intended.",
    },
    date(2026, 9, 22): {
        "planned_distance_km": 10, "workout_type": "HM-specific tune-up",
        "details": "3 km easy; drills + strides; 2 × 2 km at goal HM pace with 2:00 easy jog; 2–3 km cool-down.",
        "pace_guidance": "3:32–3:34/km. Exact rhythm, never faster than 3:30/km.", "hr_guidance": "Let HR rise naturally; it is a rehearsal, not a fitness test.",
        "recovery": "2:00 easy jog between the 2 km blocks.", "terrain_elevation": "Flat, accurately measured route with minimal interruptions.",
        "purpose": "Rehearse HM rhythm while preserving freshness after the Night Run.", "fatigue_modification": "Run only 1 × 2 km at HM pace, or 6–8 km easy, if fatigue persists.", "major_stimulus": True,
    },
}


LONG_RUNS = {
    date(2026, 8, 16): {
        "distance_km": 20,
        "details": "20 km fully easy on rolling terrain; no fast finish after Wednesday’s 3 × 3 km session.",
        "terrain": "Rolling Z2 route, approximately 300–450 m ascent; runnable surfaces and controlled descents.",
        "purpose": "Aerobic durability plus trail-strength maintenance without adding a second hard stimulus this partial week.",
        "major_stimulus": False,
        "fatigue": "Reduce to 16–18 km all easy if residual fatigue from Wednesday is still present.",
    },
    date(2026, 8, 23): {
        "distance_km": 21,
        "details": "21 km fully easy on rolling terrain; no planned faster kilometres after Friday’s economy session.",
        "terrain": "Approximately 350–500 m ascent. Smooth trails/roads; descents controlled, not raced.",
        "purpose": "Build HM durability and retain climbing/downhill tolerance while keeping the week to two hard stimuli.",
        "major_stimulus": False,
        "fatigue": "If Friday cost more than expected, run 17–19 km easy and reduce elevation.",
    },
    date(2026, 8, 29): {
        "distance_km": 22,
        "details": "22 km total: 5 km easy, 3 × 3 km @ controlled steady/HM-support effort with 1 km easy jog between, then easy to 22 km.",
        "pace": "Fast blocks 3:40–3:45/km—clearly slower than HM pace and never threshold effort.",
        "recovery": "1 km easy jog between 3 km blocks.",
        "terrain": "Approximately 300–450 m ascent overall; do the faster blocks on a flat or gently rolling runnable section.",
        "purpose": "Combine durability and controlled late-run economy; this is the week’s second major stimulus, so Friday stays easy.",
        "major_stimulus": True,
        "fatigue": "Move the long run to Sunday and rest/run 8 km easy Saturday if needed. If still tired Sunday, run 18–20 km all easy.",
    },
    date(2026, 9, 6): {
        "distance_km": 20,
        "details": "20 km fully easy on rolling terrain; no fast finish after Friday’s 1 km repetitions.",
        "terrain": "Approximately 400–550 m ascent, mostly comfortable Z2; technical descending stays controlled.",
        "purpose": "Maintain long-run durability and trail-specific strength without creating a third hard session.",
        "major_stimulus": False,
        "fatigue": "Reduce to 16–18 km and 250–350 m ascent if Friday was harder than prescribed.",
    },
    date(2026, 9, 12): {
        "distance_km": 21,
        "details": "21 km total: 5 km easy, 2 × 4 km @ controlled HM-support effort with 1 km easy jog, then easy to 21 km.",
        "pace": "Fast blocks 3:38–3:42/km—strong aerobic running, not goal-HM pace.",
        "recovery": "1 km easy jog between 4 km blocks.",
        "terrain": "Approximately 350–500 m ascent overall; faster blocks on a smooth, gently rolling segment.",
        "purpose": "Develop long-run durability and sub-race-pace economy while Friday remains only easy plus strides.",
        "major_stimulus": True,
        "fatigue": "Move to Sunday if necessary; otherwise shorten to 18 km all easy. Never force the faster blocks on tired legs.",
    },
    date(2026, 9, 20): {
        "distance_km": 16,
        "details": "16 km relaxed on gently rolling terrain; no progression and no hard descending.",
        "terrain": "Approximately 200–300 m ascent on non-technical terrain.",
        "purpose": "Retain endurance and hill familiarity while tapering fatigue seven days before the HM.",
        "major_stimulus": False,
        "fatigue": "Reduce to 12–14 km flat/easy if legs remain loaded from Tuesday or Friday.",
    },
}


def generate_plan(
    assessment: dict[str, Any],
    as_of: date,
    existing: dict[str, Any] | None = None,
    completed_activity_dates: set[str] | None = None,
) -> dict[str, Any]:
    profile = load_profile()
    target_km, volume_basis = _weekly_target(assessment)
    provisional = target_km <= 0
    # The revised template is approximately 77–79 km in its main weeks, close to
    # the athlete's recent peak. Scale only the supporting easy mileage.
    scale = min(1.05, max(0.75, target_km / 72.0)) if target_km else 0.62
    if provisional:
        scale = 0.62
    fatigue_elevated = assessment.get("fatigue", {}).get("status") == "elevated"
    cross_caution = assessment.get("fatigue", {}).get("cross_training", {}).get("caution", "low")
    quality_caution = bool(assessment.get("recent_quality_response", {}).get("caution"))
    if fatigue_elevated:
        scale *= 0.88
    elif cross_caution == "material":
        # A sizeable hike/ride is real load, but does not justify a wholesale
        # change to HM pace or conversion into fictional running kilometres.
        scale *= 0.95

    completed: list[dict[str, Any]] = []
    completed_activity_dates = completed_activity_dates or set()
    if existing:
        completed = [
            copy.deepcopy(day)
            for day in existing.get("days", [])
            if day.get("date", "") < as_of.isoformat() or day.get("date", "") in completed_activity_dates
        ]
        for day in completed:
            day["status"] = day.get("status") if day.get("status") != "planned" else "historical-plan"

    future: list[dict[str, Any]] = []
    cursor = as_of + timedelta(days=1) if as_of.isoformat() in completed_activity_dates else as_of
    while cursor <= RACE_DATE:
        days_to_race = (RACE_DATE - cursor).days
        weekday = cursor.weekday()

        if cursor == RACE_DATE:
            day = _day_template(
                cursor,
                planned_distance_km=round(3 + 21.0975 + 1, 1),
                workout_type="race",
                details="Race day: 3 km warm-up + drills/strides, Bad Ischl HM, 1 km cool-down only if desired.",
                pace_guidance="Goal pace ~3:33/km. Open controlled; pace by effort on hills/wind and avoid banking time early.",
                hr_guidance="HR is observational, not a pacing target. Use chest strap if comfortable; ignore anomalous values.",
                recovery="No interval recovery. Fuel/hydrate according to rehearsed practice.",
                terrain_elevation="Bad Ischl HM course; arrive familiar with turns and gradients.",
                purpose="Execute the primary race after a progressive, intensity-preserving taper.",
                fatigue_modification="If illness, focal pain, or medical concern is present, do not force the start.",
                major_stimulus=True,
            )
        elif cursor in SPECIAL_TAPER_DAYS and as_of >= date(2026, 9, 12):
            day = _day_template(cursor, **SPECIAL_TAPER_DAYS[cursor])
        elif cursor in PRIMARY_SESSIONS:
            spec = PRIMARY_SESSIONS[cursor]
            day = _quality(cursor, spec)
            if target_km and target_km < 55:
                day.update(
                    planned_distance_km=11.0,
                    details="3 km easy; drills + strides; 3 × 2 km at the prescribed effort with 90 s easy jog; 2 km cool-down.",
                    recovery="90 s easy jog after each 2 km rep.",
                    fatigue_modification="Run 2 × 2 km or replace with 45–60 min easy; do not make fewer reps faster.",
                )
            if cross_caution == "material":
                day["fatigue_modification"] += " Recent hike/ride load is material: use the reduced option if legs are heavy in the warm-up."
        elif cursor in SECONDARY_FRIDAYS:
            day = _quality(cursor, SECONDARY_FRIDAYS[cursor])
            if quality_caution and cursor <= as_of + timedelta(days=7):
                day.update(
                    planned_distance_km=11,
                    details="3 km easy; drills + 4 strides; 8 × 400 m controlled fast with 200 m easy jog; 2 km cool-down.",
                    purpose="Maintain economy after a strong threshold session without stacking unnecessary fast volume.",
                    fatigue_modification="Replace with 8–10 km easy plus 6 strides if legs are not springy. Do not compensate by running the 400 m reps faster.",
                )
        elif cursor in STRIDE_FRIDAYS:
            km = round(STRIDE_FRIDAYS[cursor] * scale)
            day = _base_easy(cursor, km)
            day.update(
                workout_type="easy + strides",
                details=f"{km} km easy, then 6 × 15–20 s relaxed strides on flat ground with full recovery.",
                pace_guidance="Easy running 4:30–5:10/km by feel; strides fast but relaxed, never sprinting.",
                recovery="60–90 s walk/jog after each stride.",
                terrain_elevation="Flat to gently rolling; save climbing and faster aerobic work for the planned weekend session.",
                purpose="Neuromuscular freshness without becoming a third metabolic workout.",
                fatigue_modification="Omit the strides and run 7–9 km easy, or rest if recovery is poor.",
                major_stimulus=False,
            )
        elif cursor in POST_QUALITY_LONG_RECOVERY:
            km = round(POST_QUALITY_LONG_RECOVERY[cursor] * scale)
            day = _recovery(cursor, km)
            day.update(
                details=f"{km} km very easy recovery after Saturday’s quality long run; no strides.",
                terrain_elevation="Flat to gently rolling, ideally under 100 m ascent.",
                purpose="Absorb the controlled long-run work without extending the hard stimulus into a second day.",
                fatigue_modification="Take a full rest day if soreness or fatigue changes mechanics.",
            )
        elif cursor in LONG_RUNS:
            spec = LONG_RUNS[cursor]
            planned = round(float(spec["distance_km"]) * min(1.0, max(0.92, scale)))
            day = _day_template(
                cursor,
                planned_distance_km=planned,
                workout_type="long run with controlled blocks" if spec["major_stimulus"] else "long run",
                details=spec["details"],
                pace_guidance=spec.get(
                    "pace",
                    "Easy portions 4:25–5:10/km by feel. Uphill pace is irrelevant; keep breathing controlled.",
                ),
                hr_guidance="Use HR as a secondary check with pace, terrain and feel. Ease off if response is unusually high or drift is excessive.",
                recovery=spec.get("recovery", "No structured recovery; keep the full run aerobically easy."),
                terrain_elevation=spec["terrain"],
                purpose=spec["purpose"],
                fatigue_modification=spec["fatigue"],
                major_stimulus=spec["major_stimulus"],
            )
        elif cursor == date(2026, 8, 14):
            km = round(12 * scale)
            day = _base_easy(cursor, km, rolling=True)
            day.update(
                details=f"{km} km easy Z2 on rolling terrain; no fast running two days after 3 × 3 km.",
                terrain_elevation="Approximately 200–300 m ascent, all controlled.",
                purpose="Aerobic support and trail-strength maintenance while absorbing the key HM session.",
            )
        elif cursor == date(2026, 8, 15):
            day = _day_template(
                cursor,
                workout_type="rest",
                details="Full non-running day. Optional 30–45 min walk and 10 min mobility only.",
                purpose="Create recovery before Sunday’s long run after four consecutive running days.",
            )
        elif weekday == 0:
            day = _day_template(
                cursor,
                workout_type="rest",
                details="Full non-running day. Optional easy walk and 10–15 min mobility.",
                purpose="Absorb the previous week, keep six run days sustainable, and arrive fresh for Tuesday quality.",
                fatigue_modification="Keep the rest day; do not replace missed mileage here.",
            )
        elif weekday == 2:
            km = max(8, round(10 * scale))
            day = _recovery(cursor, km)
            day.update(
                details=f"{km} km relaxed recovery/easy running after Tuesday quality.",
                terrain_elevation="Flat to gently rolling, ideally under 120 m ascent.",
            )
        elif weekday == 3:
            base_km = 8 if days_to_race <= 3 else 12
            km = max(7, round(base_km * scale))
            day = _base_easy(cursor, km, rolling=True)
            if days_to_race <= 3:
                day.update(
                    details=f"{km} km easy on gently rolling terrain; no hill sprints.",
                    terrain_elevation="Only 100–150 m ascent; avoid technical trails and eccentric downhill load.",
                    strength=None,
                )
            else:
                day.update(
                    details=f"{km} km easy Z2 on rolling terrain. Keep every climb controlled; this is not a hill workout.",
                    terrain_elevation="Approximately 250–400 m ascent on comfortable trails/roads; descents smooth and restrained.",
                    purpose="Maintain climbing strength and trail tissue tolerance without compromising HM-specific quality.",
                    strength="15–20 min microdose after the run: soleus/calf, hip stability and trunk; 2 sets, no failure or DOMS.",
                )
        elif weekday == 5:
            km = 5 if cursor == date(2026, 9, 26) else max(7, round(8 * scale))
            day = _recovery(cursor, km)
            if cursor == date(2026, 9, 26):
                day.update(
                    workout_type="shakeout",
                    details="5 km very easy + 4 × 10–12 s relaxed strides if desired.",
                    pace_guidance="No pace target; finish fresher than you started.",
                    recovery="Full walk/jog recovery after optional strides.",
                    purpose="Stay loose without adding fatigue before race day.",
                )
        else:
            # Date maps cover every planned quality/weekend day. This fallback is
            # deliberately easy so a future code/date extension cannot create an
            # accidental third stimulus.
            km = max(7, round(10 * scale))
            day = _base_easy(cursor, km)
        future.append(day)
        cursor += timedelta(days=1)

    plan = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of_date": as_of.isoformat(),
        "race": profile["goal_race"],
        "read_only_intervals_icu": True,
        "provisional": provisional,
        "volume_basis": volume_basis,
        "planning_notes": [
            "One full non-running day every Monday; six run days are enough for the current 72–79 km structure.",
            "Tuesday is the primary threshold/HM-specific session.",
            "The second major stimulus alternates: controlled Friday speed with an easy Sunday long run, or an easy Friday with a quality Saturday long run.",
            "Never combine Tuesday quality, Friday quality and a fast long run in the same week.",
            "One rolling Z2 run plus the long run provides approximately 500–900 m weekly ascent in the main block without turning hills into races.",
            "The Vienna Power Trail (24.7 km/1,000 m on 18 October) and Kürnberg Long Trail justify maintaining hills, but Bad Ischl HM remains the primary goal until 27 September.",
            "Pace ranges are conditional on synchronized fitness, terrain, weather, and recovery.",
            "Strides are neuromuscular support, not a third metabolic workout.",
            "Strength is low-volume and consolidated after Tuesday quality, with an optional Thursday microdose; no DOMS is acceptable.",
            "Completed dates are preserved on adaptive regeneration.",
            "Recent cycling, hiking, strength and other non-running activity is included in recovery/load context, but never converted into running kilometres.",
        ],
        "days": completed + future,
        "change_log": existing.get("change_log", []) if existing else [],
    }
    return plan


def reconcile_completed_days(
    existing: dict[str, Any] | None,
    activities: list[dict[str, Any]],
    as_of: date,
) -> dict[str, Any] | None:
    """Attach actuals/status without changing the original prescription fields."""
    if not existing:
        return None
    result = copy.deepcopy(existing)
    actual_by_date: dict[str, list[dict[str, Any]]] = {}
    for activity in activities:
        if activity.get("date") and activity["date"] <= as_of.isoformat():
            actual_by_date.setdefault(activity["date"], []).append(activity)
    for day in result.get("days", []):
        day_date = day.get("date", "")
        is_past = day_date < as_of.isoformat()
        actuals = actual_by_date.get(day_date, [])
        if not is_past and not actuals:
            continue
        actual_km = round(sum(float(item.get("distance_km") or 0) for item in actuals), 2)
        planned_km = float(day.get("planned_distance_km") or 0)
        if actuals:
            day["status"] = "completed"
        elif planned_km > 0:
            day["status"] = "missed"
        else:
            day["status"] = "completed-rest"
        day["actual"] = {
            "distance_km": actual_km,
            "activity_ids": [item.get("id") for item in actuals],
            "activities": [
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "workout_type": item.get("workout_type"),
                    "distance_km": item.get("distance_km"),
                    "training_load": item.get("training_load"),
                }
                for item in actuals
            ],
            "distance_adherence_percent": round(actual_km / planned_km * 100, 1) if planned_km else None,
        }
    return result


def compare_plans(old: dict[str, Any] | None, new: dict[str, Any], change_date: date) -> list[dict[str, Any]]:
    if not old:
        return []
    old_days = {day["date"]: day for day in old.get("days", [])}
    changes = []
    for day in new.get("days", []):
        if day["date"] < change_date.isoformat() or day["date"] not in old_days:
            continue
        before = old_days[day["date"]]
        keys = ("planned_distance_km", "workout_type", "details", "pace_guidance")
        if any(before.get(key) != day.get(key) for key in keys):
            changes.append(
                {
                    "date": day["date"],
                    "original": f"{before.get('workout_type')}: {before.get('details')}",
                    "updated": f"{day.get('workout_type')}: {day.get('details')}",
                }
            )
    return changes


def write_plan(plan: dict[str, Any]) -> None:
    PLAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLAN_PATH.write_text(json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = [
        "# Bad Ischl Half Marathon Plan",
        "",
        f"Generated: {plan['generated_at']}",
        f"Race: {plan['race']['name']} — {plan['race']['date']}",
        f"Goal: {plan['race']['goal']}",
        f"Volume basis: {plan['volume_basis']}",
        "",
    ]
    if plan.get("provisional"):
        lines += [
            "> **Provisional:** No synchronized training history was available. Do not execute this plan as personalized coaching yet; run the first sync and regenerate it.",
            "",
        ]
    lines += ["## Guardrails", ""] + [f"- {note}" for note in plan["planning_notes"]] + [""]
    current_week = None
    for day in plan["days"]:
        day_date = date.fromisoformat(day["date"])
        week_start = day_date - timedelta(days=day_date.weekday())
        if week_start != current_week:
            current_week = week_start
            week_end = min(RACE_DATE, week_start + timedelta(days=6))
            lines += [f"## Week of {week_start.isoformat()}–{week_end.isoformat()}", ""]
        lines += [
            f"### {day['day']} — {day['date']} — {day['workout_type']}",
            "",
            f"- **Planned:** {day.get('planned_distance_km', 0):g} km" + (f" / {day['planned_duration_minutes']} min" if day.get("planned_duration_minutes") else ""),
            f"- **Status:** {day.get('status', 'planned')}",
            f"- **Workout:** {day['details']}",
            f"- **Pace:** {day['pace_guidance']}",
            f"- **HR:** {day['hr_guidance']}",
            f"- **Recovery:** {day['recovery']}",
            f"- **Terrain/elevation:** {day['terrain_elevation']}",
            f"- **Purpose:** {day['purpose']}",
            f"- **If fatigued:** {day['fatigue_modification']}",
        ]
        if day.get("strength"):
            lines.append(f"- **Strength:** {day['strength']}")
        lines.append("")
    PLAN_MD_PATH.write_text("\n".join(lines), encoding="utf-8")
