import { todayIso } from "../db/runtime";

export type GeneratedSession = { date: string; workoutType: string; title: string; details: string; distanceKm: number; paceGuidance: string; hrGuidance: string; purpose: string; fatigueModification: string; majorStimulus: boolean };
type PlannerInput = { athlete: Record<string, unknown>; goal: Record<string, unknown>; latestTest?: Record<string, unknown> | null; recentFeedback?: Record<string, unknown> | null; recentActivities?: Record<string, unknown>[] };
type Experience = "new" | "recreational" | "competitive" | "advanced";
type Profile = { experience: Experience; weeklyKm: number; trainingDays: number; availableDays: number[]; longRunDay: number; restriction: string; confirmed: boolean; longestRecentSessionKm: number | null };

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The built-in generator stays deterministic until a sport-specific engine has comparable guardrails. */
export async function generateTrainingPlan(input: PlannerInput): Promise<{ rationale: string; sessions: GeneratedSession[] }> {
  const profile = readProfile(input.athlete);
  const blocked = planningReadiness(input, profile);
  if (blocked.length) throw new Error(`Plan draft blocked: ${blocked.join(" ")}`);
  return deterministicRunningPlan(input, profile);
}

export function planningReadiness(input: PlannerInput, profile = readProfile(input.athlete)): string[] {
  const reasons: string[] = [];
  if (!input.goal || !String(input.goal.event_date ?? input.goal.eventDate ?? "").trim()) reasons.push("Add an active goal with an event date first.");
  if (String(input.athlete.primary_sport ?? input.athlete.primarySport ?? "running") !== "running") reasons.push("Cycling, triathlon, and other endurance profiles are recorded, but their sport-specific plan generator is not enabled yet.");
  if (!input.athlete.onboarding_completed_at && !input.athlete.onboardingCompletedAt) reasons.push("Complete the training profile first.");
  if (!profile.confirmed) reasons.push("Confirm that the profile reflects current training and health status.");
  if (profile.restriction !== "none") reasons.push("Current pain, illness, or a restriction requires coach review instead of an automated draft.");
  if (profile.trainingDays < 2 || profile.availableDays.length < profile.trainingDays) reasons.push("Select at least two normally available training days.");
  if (!Number.isFinite(profile.weeklyKm) || profile.weeklyKm < 5) reasons.push("Enter a current sustainable weekly running volume of at least 5 km, or build the first plan manually with a coach.");
  const pain = String(input.recentFeedback?.pain ?? "").trim(); const fatigue = Number(input.recentFeedback?.fatigue ?? 0);
  if (pain || fatigue >= 8) reasons.push("Recent pain or high fatigue needs review before generating a new draft.");
  return reasons;
}

function deterministicRunningPlan(input: PlannerInput, profile: Profile) {
  const start = parseDate(todayIso()); const raceDate = parseDate(String(input.goal.event_date ?? input.goal.eventDate ?? todayIso()));
  const totalDays = Math.max(7, Math.min(112, daysBetween(start, raceDate) + 1));
  const observedWeeklyKm = recentRunningWeeklyKm(input.recentActivities ?? []); const baselineKm = safeBaseline(profile.weeklyKm, observedWeeklyKm, profile.experience);
  const goalPace = paceFromGoal(input.goal); const lt2Pace = Number(input.latestTest?.lt2_pace_seconds_km ?? input.latestTest?.lt2PaceSecondsKm ?? 0); const lt2Hr = Number(input.latestTest?.lt2_hr ?? input.latestTest?.lt2Hr ?? 0);
  const sessions: GeneratedSession[] = [];
  for (let index = 0; index < totalDays; index += 1) {
    const date = addDays(start, index); const daysToRace = daysBetween(date, raceDate);
    if (daysToRace === 0) { sessions.push(raceSession(input.goal, goalPace)); continue; }
    const taper = daysToRace <= 3 ? .42 : daysToRace <= 8 ? .62 : daysToRace <= 15 ? .82 : 1; const day = date.getUTCDay();
    if (!profile.availableDays.includes(day)) { sessions.push({ date: formatDate(date), ...rest("A planned rest day protects recovery and keeps the plan within stated availability.") }); continue; }
    sessions.push({ date: formatDate(date), ...runningSession(roleForDay(day, profile), baselineKm, taper, profile, goalPace, lt2Pace, lt2Hr) });
  }
  const observed = observedWeeklyKm ? `Recent synced running averages ${Math.round(observedWeeklyKm)} km/week; the stated baseline is used conservatively.` : "No recent synced running volume was available, so the stated sustainable baseline is used.";
  const quality = profile.experience === "new" ? "New-to-running profiles receive only easy and long-run progression, not threshold work." : profile.experience === "recreational" ? "Recreational profiles receive at most one low-cost economy stimulus per week." : "Quality sessions are limited by stated availability and separated by recovery days.";
  return { rationale: `Coach-reviewed running draft based on ${Math.round(baselineKm)} km/week, ${profile.trainingDays} selected training days (${profile.availableDays.map((day) => weekdays[day].slice(0, 3)).join(", ")}), ${weekdays[profile.longRunDay]} long run, and ${profile.experience} experience. ${observed} ${quality} The draft must still be reviewed before publication.`, sessions };
}

function readProfile(athlete: Record<string, unknown>): Profile {
  const availability = readJson(athlete.availability_json ?? athlete.availability); const requested = Number(athlete.training_days ?? athlete.trainingDays ?? 0); const longRun = dayNumber(String(athlete.long_run_day ?? athlete.longRunDay ?? "Sunday"));
  const preferred = toDayNumbers(availability.preferredTrainingDays); const availableDays = preferred.length ? preferred : fallbackDays(Math.max(2, Math.min(7, requested || 4)), longRun);
  const experienceValue = String(athlete.experience_level ?? athlete.experienceLevel ?? "recreational"); const experience: Experience = ["new", "recreational", "competitive", "advanced"].includes(experienceValue) ? experienceValue as Experience : "recreational";
  return { experience, weeklyKm: Number(athlete.weekly_target_km ?? athlete.weeklyTargetKm ?? 0), trainingDays: requested || availableDays.length, availableDays, longRunDay: availableDays.includes(longRun) ? longRun : availableDays.at(-1) ?? longRun, restriction: String(availability.currentRestriction ?? "none"), confirmed: availability.planReadinessConfirmed === true, longestRecentSessionKm: finiteOrNull(availability.longestRecentSessionKm) };
}

function roleForDay(day: number, profile: Profile): "long" | "threshold" | "economy" | "easy" | "new" {
  if (day === profile.longRunDay) return "long"; const nonLongDays = profile.availableDays.filter((item) => item !== profile.longRunDay);
  if (profile.experience === "new") return "new"; const thresholdDay = nonLongDays[Math.floor(nonLongDays.length / 2)];
  if ((profile.experience === "competitive" || profile.experience === "advanced") && profile.trainingDays >= 3 && day === thresholdDay) return "threshold";
  if (day === nonLongDays[0] && profile.trainingDays >= 3) return "economy"; return "easy";
}

function runningSession(role: ReturnType<typeof roleForDay>, weekly: number, taper: number, profile: Profile, goalPace: number, lt2Pace: number, lt2Hr: number): Omit<GeneratedSession, "date"> {
  const longShare = profile.experience === "new" ? .25 : .29; const hasThreshold = (profile.experience === "competitive" || profile.experience === "advanced") && profile.trainingDays >= 3; const hasEconomy = profile.experience !== "new" && profile.trainingDays >= 3; const easyCount = Math.max(1, profile.trainingDays - 1 - Number(hasThreshold) - Number(hasEconomy));
  const distance = role === "long" ? weekly * longShare * taper : role === "threshold" ? weekly * .19 * taper : role === "economy" ? weekly * .15 * taper : weekly * (1 - longShare - (hasThreshold ? .19 : 0) - (hasEconomy ? .15 : 0)) / easyCount * taper;
  const uncappedKm = Math.max(role === "new" ? 2 : 3, distance); const longCap = profile.longestRecentSessionKm && profile.longestRecentSessionKm > 0 ? Math.max(3, profile.longestRecentSessionKm * 1.1) : Infinity; const km = roundKm(role === "long" ? Math.min(uncappedKm, longCap) : uncappedKm);
  const easy = (title: string, details: string, purpose: string): Omit<GeneratedSession, "date"> => ({ workoutType: role === "new" ? "run_walk" : "easy", title, details, distanceKm: km, paceGuidance: "Conversational effort; slow down for heat, hills, or accumulated fatigue.", hrGuidance: "Use heart rate as a cap and secondary check, never as a target.", purpose, fatigueModification: "Reduce distance or rest if movement changes, pain appears, or fatigue is unusual.", majorStimulus: false });
  if (role === "new") return easy("Easy run / walk", `${km} km at an easy, repeatable effort. Planned walk breaks are allowed and should not be made up later.`, "Build a durable running habit without forcing intensity.");
  if (role === "long") return easy("Long aerobic run", `${km} km easy on terrain appropriate to the goal. No fast finish unless added deliberately in draft review.`, "Develop aerobic durability and musculoskeletal tolerance.");
  if (role === "economy") return { ...easy("Easy running + relaxed strides", `${km} km easy including 6 × 15 s relaxed strides with full recovery. Fast but never sprinting.`, "Maintain coordination and economy with minimal metabolic cost."), workoutType: "economy" };
  if (role === "threshold") { const pace = lt2Pace || (goalPace ? goalPace - 3 : 0); return { workoutType: "threshold", title: taper < .7 ? "Threshold tune-up" : "Controlled threshold intervals", details: taper < .7 ? "Warm up; 3 × 5 min controlled with 2 min easy jog; cool down." : "Warm up; 4 × 8 min controlled with 90 s easy jog; cool down.", distanceKm: km, paceGuidance: pace ? `${formatPace(pace - 3)}–${formatPace(pace + 3)}/km; even repetitions, no final-rep test.` : "Controlled threshold effort; finish able to complete another repetition.", hrGuidance: lt2Hr ? `Let HR rise naturally but generally remain below ${lt2Hr + 2} bpm late in each repetition.` : "Interpret HR with pace, drift, duration, and feel.", purpose: "Develop sustainable speed while keeping the stimulus repeatable.", fatigueModification: "Remove one repetition or run easy; never make fewer repetitions faster.", majorStimulus: true }; }
  return easy("Easy aerobic run", `${km} km genuinely easy on flat to gently rolling terrain.`, "Aerobic development and durability without compromising the next key session.");
}

function raceSession(goal: Record<string, unknown>, goalPace: number): GeneratedSession { const distance = Number(goal.distance_km ?? goal.distanceKm ?? 0); return { date: String(goal.event_date ?? goal.eventDate).slice(0, 10), workoutType: "race", title: String(goal.title ?? "Goal event"), details: "Race day. Use the pacing and fueling notes agreed in the coach review.", distanceKm: distance, paceGuidance: goalPace ? `${formatPace(goalPace)}/km target rhythm; conditions and execution govern.` : "Use the agreed race strategy.", hrGuidance: "Do not chase heart rate; use effort, pace, conditions, and race execution together.", purpose: "Execute the primary goal event.", fatigueModification: "If illness, focal pain, or unsafe symptoms are present, do not start without appropriate professional advice.", majorStimulus: true }; }
function rest(purpose: string): Omit<GeneratedSession, "date"> { return { workoutType: "rest", title: "Rest / mobility", details: "Rest from running. Optional easy walking and mobility.", distanceKm: 0, paceGuidance: "None.", hrGuidance: "None.", purpose, fatigueModification: "Keep the rest day and address worsening pain rather than training through it.", majorStimulus: false }; }
function recentRunningWeeklyKm(activities: Record<string, unknown>[]) { const cutoff = Date.now() - 28 * 86400000; const total = activities.filter((activity) => /run/i.test(String(activity.activity_type ?? activity.activityType ?? "")) && new Date(String(activity.activity_date ?? activity.activityDate ?? "")).getTime() >= cutoff).reduce((sum, activity) => sum + Math.max(0, Number(activity.distance_km ?? activity.distanceKm ?? 0)), 0); return total > 0 ? total / 4 : 0; }
function safeBaseline(stated: number, observed: number, experience: Experience) { const lower = experience === "new" ? 5 : 12; const available = observed > 0 ? Math.min(stated || observed, observed * 1.1) : stated; return Math.max(lower, Math.min(140, available)); }
function readJson(value: unknown): Record<string, any> { try { return typeof value === "string" ? JSON.parse(value) : (value && typeof value === "object" ? value as Record<string, any> : {}); } catch { return {}; } }
function toDayNumbers(value: unknown) { const values = Array.isArray(value) ? value : String(value ?? "").split(","); return [...new Set(values.map((item) => dayNumber(String(item).trim())).filter((day) => day >= 0))].sort((a, b) => a - b); }
function dayNumber(value: string) { return weekdays.findIndex((day) => day.toLowerCase().startsWith(value.toLowerCase().slice(0, 3))); }
function fallbackDays(count: number, longDay: number) { const choices = [1, 3, 5, 6, 0, 2, 4]; const days = [longDay]; for (const day of choices) if (days.length < count && !days.includes(day)) days.push(day); return days.sort((a, b) => a - b); }
function finiteOrNull(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function roundKm(value: number) { return Math.round(value * 2) / 2; }
function paceFromGoal(goal: Record<string, unknown>) { const seconds = Number(goal.goal_time_seconds ?? goal.goalTimeSeconds ?? 0); const distance = Number(goal.distance_km ?? goal.distanceKm ?? 0); return seconds > 0 && distance > 0 ? Math.round(seconds / distance) : 0; }
function parseDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00Z`); }
function addDays(date: Date, days: number) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function daysBetween(first: Date, second: Date) { return Math.round((second.getTime() - first.getTime()) / 86400000); }
function formatDate(date: Date) { return date.toISOString().slice(0, 10); }
function formatPace(seconds: number) { const rounded = Math.max(0, Math.round(seconds)); return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`; }
