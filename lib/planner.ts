import { platformEnv, todayIso } from "../db/runtime";

export type GeneratedSession = {
  date: string; workoutType: string; title: string; details: string; distanceKm: number;
  paceGuidance: string; hrGuidance: string; purpose: string; fatigueModification: string; majorStimulus: boolean;
};

type PlannerInput = {
  athlete: Record<string, unknown>;
  goal: Record<string, unknown>;
  latestTest?: Record<string, unknown> | null;
  recentFeedback?: Record<string, unknown> | null;
  recentActivities?: Record<string, unknown>[];
};

export async function generateTrainingPlan(input: PlannerInput): Promise<{ rationale: string; sessions: GeneratedSession[] }> {
  const engineUrl = platformEnv().COACH_ENGINE_URL;
  if (engineUrl) {
    const response = await fetch(`${engineUrl.replace(/\/$/, "")}/v1/plans/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    if (response.ok) return await response.json() as { rationale: string; sessions: GeneratedSession[] };
  }
  return deterministicPlan(input);
}

function deterministicPlan(input: PlannerInput) {
  const start = parseDate(todayIso());
  const raceDate = parseDate(String(input.goal.event_date ?? input.goal.eventDate ?? todayIso()));
  const totalDays = Math.max(7, Math.min(112, daysBetween(start, raceDate) + 1));
  const weeklyTarget = Math.max(25, Math.min(140, Number(input.athlete.weeklyTargetKm ?? input.athlete.weekly_target_km ?? 55)));
  const goalPace = paceFromGoal(input.goal);
  const lt2Pace = Number(input.latestTest?.lt2_pace_seconds_km ?? input.latestTest?.lt2PaceSecondsKm ?? 0);
  const lt2Hr = Number(input.latestTest?.lt2_hr ?? input.latestTest?.lt2Hr ?? 0);
  const pain = String(input.recentFeedback?.pain ?? "").trim();
  const fatigue = Number(input.recentFeedback?.fatigue ?? 0);
  const protectedWeek = Boolean(pain) || fatigue >= 8;
  const sessions: GeneratedSession[] = [];

  for (let index = 0; index < totalDays; index += 1) {
    const date = addDays(start, index);
    const daysToRace = daysBetween(date, raceDate);
    const taperFactor = daysToRace <= 3 ? 0.42 : daysToRace <= 8 ? 0.62 : daysToRace <= 15 ? 0.82 : 1;
    const day = date.getUTCDay();
    const recoveryOverride = protectedWeek && index < 7;
    let session = sessionForDay(day, weeklyTarget, taperFactor, goalPace, lt2Pace, lt2Hr, recoveryOverride);
    if (daysToRace === 0) {
      const distance = Number(input.goal.distance_km ?? input.goal.distanceKm ?? 0);
      session = {
        workoutType: "race", title: String(input.goal.title ?? "Goal event"),
        details: "Race day. Use the published pacing and fueling notes agreed with the coach.", distanceKm: distance,
        paceGuidance: goalPace ? `${formatPace(goalPace)}/km target rhythm; conditions and execution govern.` : "Use the agreed race strategy.",
        hrGuidance: "Do not chase heart rate; use effort, pace, conditions, and race execution together.",
        purpose: "Execute the primary goal event.", fatigueModification: "If illness, focal pain, or unsafe symptoms are present, do not start without appropriate professional advice.", majorStimulus: true,
      };
    }
    sessions.push({ date: formatDate(date), ...session });
  }
  const thresholdSource = lt2Pace ? `latest LT2 estimate (${formatPace(lt2Pace)}/km)` : goalPace ? `goal pace (${formatPace(goalPace)}/km)` : "effort-based guidance";
  return {
    rationale: `${Math.round(weeklyTarget)} km/week baseline with two controlled stimuli, progressive durability, and a race-specific taper. Intensity guidance uses ${thresholdSource}. ${protectedWeek ? "The opening week is recovery-protected because recent feedback needs coach review." : "The draft still requires coach review before publication."}`,
    sessions,
  };
}

function sessionForDay(day: number, weekly: number, taper: number, goalPace: number, lt2Pace: number, lt2Hr: number, recovery: boolean): Omit<GeneratedSession, "date"> {
  const km = (share: number) => Math.max(0, Math.round(weekly * share * taper * 2) / 2);
  const easy = (distance: number, title = "Easy aerobic run"): Omit<GeneratedSession, "date"> => ({
    workoutType: "easy", title, details: `${distance} km genuinely easy on flat to gently rolling terrain.`, distanceKm: distance,
    paceGuidance: "Conversational effort; slow further for heat, hills, or accumulated fatigue.", hrGuidance: "Use heart rate as a cap and secondary check, not a target.",
    purpose: "Aerobic development and durability without compromising key sessions.", fatigueModification: `Reduce to ${Math.max(0, distance - 3)} km or rest if mechanics change or fatigue is abnormal.`, majorStimulus: false,
  });
  if (recovery) return day === 0 ? easy(km(.18), "Short easy run") : day === 3 ? easy(km(.12), "Recovery run") : rest("Recovery-protected day while feedback is reviewed.");
  if (day === 1) return rest("Absorb the weekend load and prepare for the next quality stimulus.");
  if (day === 2) {
    const pace = lt2Pace || (goalPace ? goalPace - 3 : 0);
    return { workoutType: "threshold", title: taper < .7 ? "Threshold tune-up" : "Controlled threshold intervals", details: taper < .7 ? "Warm up; 3 × 5 min controlled with 2 min easy jog; cool down." : "Warm up; 4 × 8 min controlled with 90 s easy jog; cool down.", distanceKm: km(.19), paceGuidance: pace ? `${formatPace(pace - 3)}–${formatPace(pace + 3)}/km; even repetitions, no final-rep test.` : "Controlled threshold effort; finish able to complete another repetition.", hrGuidance: lt2Hr ? `Let HR rise naturally but generally remain below ${lt2Hr + 2} bpm late in each repetition.` : "Interpret HR with pace, drift, duration, and feel.", purpose: "Develop sustainable speed while keeping the stimulus repeatable.", fatigueModification: "Remove one repetition or run easy; never make fewer repetitions faster.", majorStimulus: true };
  }
  if (day === 3) return easy(km(.12), "Recovery run");
  if (day === 4) return easy(km(.15));
  if (day === 5) return { ...easy(km(.15), taper < .7 ? "Strides and race rhythm" : "Running economy"), workoutType: "economy", details: taper < .7 ? "Easy running plus 6 × 15 s relaxed strides with full recovery." : "Easy running plus 8 × 45 s at relaxed 5K effort with generous jog recovery.", paceGuidance: "Fast but relaxed, mechanically clean, never sprinting.", purpose: "Maintain economy and speed reserve with low metabolic cost.", majorStimulus: taper >= .7 };
  if (day === 6) return easy(km(.1), "Short easy run");
  return { ...easy(km(.29), "Long aerobic run"), workoutType: "long_run", details: `${km(.29)} km easy on terrain appropriate to the goal. No fast finish unless the coach adds it explicitly.`, purpose: "Aerobic durability and musculoskeletal resilience.", fatigueModification: `Reduce by 20–30% and simplify terrain if the prior quality session cost more than expected.` };
}

function rest(purpose: string): Omit<GeneratedSession, "date"> { return { workoutType: "rest", title: "Rest / mobility", details: "Rest from running. Optional easy walking and mobility.", distanceKm: 0, paceGuidance: "None.", hrGuidance: "None.", purpose, fatigueModification: "Keep the rest day and address worsening pain rather than cross-training through it.", majorStimulus: false }; }
function paceFromGoal(goal: Record<string, unknown>) { const seconds = Number(goal.goal_time_seconds ?? goal.goalTimeSeconds ?? 0); const distance = Number(goal.distance_km ?? goal.distanceKm ?? 0); return seconds > 0 && distance > 0 ? Math.round(seconds / distance) : 0; }
function parseDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00Z`); }
function addDays(date: Date, days: number) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function daysBetween(first: Date, second: Date) { return Math.round((second.getTime() - first.getTime()) / 86400000); }
function formatDate(date: Date) { return date.toISOString().slice(0, 10); }
function formatPace(seconds: number) { const rounded = Math.max(0, Math.round(seconds)); return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`; }
