import { NextRequest } from "next/server";
import { requireApiUser, requireAthleteAccess } from "../../../lib/auth";
import { audit, getWorkspaceState } from "../../../lib/workspace";
import { generateTrainingPlan } from "../../../lib/planner";
import { processPendingWork, queueCoachAlert } from "../../../lib/pipeline";
import { decryptSecret } from "../../../lib/secrets";
import { id, nowIso, platformEnv, todayIso } from "../../../db/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const athleteId = request.nextUrl.searchParams.get("athleteId");
    let state = await getWorkspaceState(user, athleteId);
    const selectedId = String(state.selectedAthlete?.id ?? "");
    const connection = state.connections?.find((item: Record<string, unknown>) => item.provider === "intervals" && item.status === "active");
    const stale = connection && (!connection.last_sync_at || Date.now() - new Date(String(connection.last_sync_at)).getTime() > 24 * 60 * 60 * 1000);
    if (selectedId && stale) { await queuePipeline(user.id, selectedId); await processPendingWork(selectedId); state = await getWorkspaceState(user, selectedId); }
    return Response.json(state);
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return new Response("Cross-origin write rejected.", { status: 403 });
    const user = await requireApiUser();
    const body = await request.json() as Record<string, unknown>;
    const action = requiredText(body.action, "action");
    const athleteId = optionalText(body.athleteId);
    if (action !== "inviteAthlete") {
      if (!athleteId) throw new Error("An athlete must be selected.");
      await requireAthleteAccess(user, athleteId, false);
    }
    if (action === "inviteAthlete") await inviteAthlete(user, body, request.nextUrl.origin);
    else if (action === "saveGoal") { coachOnly(user); await saveGoal(user.id, athleteId!, body); }
    else if (action === "saveLactateTest") { coachOnly(user); await saveLactateTest(user.id, athleteId!, body); }
    else if (action === "requestLactateTest") { await requestLactateTest(user, athleteId!, body); await processPendingWork(athleteId!); }
    else if (action === "savePerformanceSnapshot") { coachOnly(user); await savePerformanceSnapshot(user.id, athleteId!, body); }
    else if (action === "submitFeedback") await submitFeedback(user.id, athleteId!, body);
    else if (action === "completeOnboarding") await completeOnboarding(user.id, athleteId!, body);
    else if (action === "saveCoachNote") { coachOnly(user); await saveCoachNote(user.id, athleteId!, body); }
    else if (action === "updateAthlete") { coachOnly(user); await updateAthlete(user.id, athleteId!, body); }
    else if (action === "generatePlan") { coachOnly(user); await generatePlan(user.id, athleteId!); }
    else if (action === "publishPlan") { coachOnly(user); await publishPlan(user.id, athleteId!, requiredText(body.planId, "planId")); await processPendingWork(athleteId!); }
    else if (action === "updatePlanSession") { coachOnly(user); await updatePlanSession(user.id, athleteId!, body); }
    else if (action === "logSession") await logSession(user.id, athleteId!, body);
    else if (action === "runPipeline") { await queuePipeline(user.id, athleteId!); await processPendingWork(athleteId!); }
    else if (action === "disconnectIntervals") await disconnectIntervals(user.id, athleteId!);
    else throw new Error("Unsupported workspace action.");
    return Response.json({ ok: true, state: await getWorkspaceState(user, athleteId) });
  } catch (error) { return apiError(error); }
}

async function inviteAthlete(user: { id: string; role: string }, body: Record<string, unknown>, origin: string) {
  coachOnly(user);
  const db = platformEnv().DB;
  const email = requiredText(body.email, "email").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid athlete email address.");
  const displayName = requiredText(body.displayName, "displayName").trim();
  const athleteId = id("athlete"); const invitationId = id("invite"); const timestamp = nowIso();
  await db.batch([
    db.prepare("INSERT INTO athletes (id, email, display_name, primary_sport, timezone, status, weekly_target_km, availability_json, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, 'invited', ?, '{}', ?, ?)").bind(athleteId, email, displayName, optionalText(body.timezone) ?? "Europe/Vienna", numberOrNull(body.weeklyTargetKm), timestamp, timestamp),
    db.prepare("INSERT INTO coach_athletes (coach_user_id, athlete_id, relationship_role, status, created_at) VALUES (?, ?, 'primary', 'active', ?)").bind(user.id, athleteId, timestamp),
    db.prepare("INSERT INTO invitations (id, athlete_id, coach_user_id, email, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").bind(invitationId, athleteId, user.id, email, timestamp),
    db.prepare("INSERT INTO notifications (id, athlete_id, recipient_email, notification_type, subject, body, status, created_at) VALUES (?, ?, ?, 'athlete_invitation', ?, ?, 'queued', ?)").bind(id("notification"), athleteId, email, "Your Personal Besties training dashboard", `${displayName}, your coach has prepared a private Personal Besties workspace for you. Visit ${origin}, enter this email address, and use the 6-digit sign-in code from the newest email.`, timestamp),
  ]);
  await processPendingWork(athleteId);
  await audit(user as never, "invite", "athlete", athleteId, athleteId, { email });
}

async function updatePlanSession(userId: string, athleteId: string, body: Record<string, unknown>) {
  const sessionId = requiredText(body.sessionId, "sessionId");
  const db = platformEnv().DB;
  const session = await db.prepare(`SELECT ps.id FROM planned_sessions ps JOIN training_plans tp ON tp.id = ps.plan_id
    WHERE ps.id = ? AND ps.athlete_id = ? AND tp.status = 'draft'`).bind(sessionId, athleteId).first();
  if (!session) throw new Error("Only sessions in the current draft can be edited.");
  await db.prepare(`UPDATE planned_sessions SET session_date = ?, title = ?, details = ?, planned_distance_km = ?,
    pace_guidance = ?, hr_guidance = ?, purpose = ?, major_stimulus = ? WHERE id = ?`)
    .bind(requiredDate(body.sessionDate), requiredText(body.title, "title"), requiredText(body.details, "details"), numberOrNull(body.plannedDistanceKm), optionalText(body.paceGuidance), optionalText(body.hrGuidance), optionalText(body.purpose), body.majorStimulus ? 1 : 0, sessionId).run();
  await audit({ id: userId } as never, "update", "planned_session", sessionId, athleteId);
}

async function logSession(userId: string, athleteId: string, body: Record<string, unknown>) {
  const sessionId = requiredText(body.sessionId, "sessionId");
  const status = requiredText(body.status, "status");
  if (!new Set(["completed", "skipped"]).has(status)) throw new Error("Choose completed or skipped.");
  const db = platformEnv().DB;
  const session = await db.prepare(`SELECT ps.id FROM planned_sessions ps JOIN training_plans tp ON tp.id = ps.plan_id
    WHERE ps.id = ? AND ps.athlete_id = ? AND tp.status = 'published'`).bind(sessionId, athleteId).first();
  if (!session) throw new Error("Only sessions from the published plan can be logged.");
  await db.prepare(`UPDATE planned_sessions SET status = ?, actual_distance_km = ?, actual_duration_minutes = ?,
    completion_rpe = ?, athlete_comment = ?, completed_at = ? WHERE id = ?`)
    .bind(status, numberOrNull(body.actualDistanceKm), numberOrNull(body.actualDurationMinutes), numberOrNull(body.completionRpe), optionalText(body.athleteComment), nowIso(), sessionId).run();
  await audit({ id: userId } as never, "log", "planned_session", sessionId, athleteId, { status });
}

async function saveGoal(userId: string, athleteId: string, body: Record<string, unknown>) {
  const db = platformEnv().DB; const goalId = optionalText(body.goalId) ?? id("goal");
  await db.prepare(`INSERT INTO goals (id, athlete_id, title, event_date, distance_km, goal_time_seconds, priority, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, event_date=excluded.event_date, distance_km=excluded.distance_km, goal_time_seconds=excluded.goal_time_seconds, priority=excluded.priority, notes=excluded.notes`)
    .bind(goalId, athleteId, requiredText(body.title, "title"), requiredDate(body.eventDate), numberOrNull(body.distanceKm), numberOrNull(body.goalTimeSeconds), optionalText(body.priority) ?? "A", optionalText(body.notes), nowIso()).run();
  await audit({ id: userId } as never, "save", "goal", goalId, athleteId);
}

async function saveLactateTest(userId: string, athleteId: string, body: Record<string, unknown>) {
  const db = platformEnv().DB; const testId = id("test"); const timestamp = nowIso();
  await db.prepare("INSERT INTO lactate_tests (id, athlete_id, test_date, protocol, venue, lt1_lactate, lt1_hr, lt1_pace_seconds_km, lt2_lactate, lt2_hr, lt2_pace_seconds_km, interpretation_method, confidence, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(testId, athleteId, requiredDate(body.testDate), requiredText(body.protocol, "protocol"), optionalText(body.venue), numberOrNull(body.lt1Lactate), numberOrNull(body.lt1Hr), numberOrNull(body.lt1PaceSecondsKm), numberOrNull(body.lt2Lactate), numberOrNull(body.lt2Hr), numberOrNull(body.lt2PaceSecondsKm), optionalText(body.interpretationMethod), optionalText(body.confidence) ?? "moderate", optionalText(body.notes), timestamp).run();
  const stages = Array.isArray(body.stages) ? body.stages as Record<string, unknown>[] : [];
  if (stages.length) await db.batch(stages.slice(0, 30).map((stage, index) => db.prepare("INSERT INTO lactate_stages (id, test_id, stage_number, duration_seconds, pace_seconds_km, speed_kph, heart_rate, lactate_mmol, rpe) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id("stage"), testId, index + 1, numberOrNull(stage.durationSeconds), numberOrNull(stage.paceSecondsKm), numberOrNull(stage.speedKph), numberOrNull(stage.heartRate), requiredNumber(stage.lactateMmol, "stage lactate"), numberOrNull(stage.rpe))));
  await audit({ id: userId } as never, "create", "lactate_test", testId, athleteId, { stages: stages.length });
}

async function requestLactateTest(user: { id: string; role: string }, athleteId: string, body: Record<string, unknown>) {
  const db = platformEnv().DB;
  const athlete = await db.prepare("SELECT display_name FROM athletes WHERE id = ?").bind(athleteId).first<{ display_name: string }>();
  const coach = await db.prepare(`SELECT u.email, u.display_name FROM users u JOIN coach_athletes ca ON ca.coach_user_id = u.id
    WHERE ca.athlete_id = ? AND ca.status = 'active' ORDER BY CASE ca.relationship_role WHEN 'primary' THEN 0 ELSE 1 END LIMIT 1`).bind(athleteId).first<{ email: string; display_name: string }>();
  if (!athlete || !coach?.email) throw new Error("No coach email is assigned to this athlete yet.");
  const requestId = id("test_request"); const timestamp = nowIso();
  const preferredDate = optionalText(body.preferredDate); const availability = optionalText(body.availability); const note = optionalText(body.note);
  const timing = preferredDate ? `Preferred date: ${preferredDate}.` : "No exact date requested yet.";
  await db.batch([
    db.prepare("INSERT INTO lactate_test_requests (id, athlete_id, requested_by, preferred_date, availability, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?)")
      .bind(requestId, athleteId, user.id, preferredDate, availability, note, timestamp),
    db.prepare("INSERT INTO notifications (id, athlete_id, recipient_email, notification_type, subject, body, status, created_at) VALUES (?, ?, ?, 'lactate_test_request', ?, ?, 'queued', ?)")
      .bind(id("notification"), athleteId, coach.email, `Lactate test request from ${athlete.display_name}`, `${athlete.display_name} would like to arrange a lactate test. ${timing}${availability ? ` Availability: ${availability}.` : ""}${note ? ` Note: ${note}` : ""}`, timestamp),
  ]);
  await audit(user as never, "request", "lactate_test", requestId, athleteId, { preferredDate });
}

async function savePerformanceSnapshot(userId: string, athleteId: string, body: Record<string, unknown>) {
  const snapshotId = id("performance");
  await platformEnv().DB.prepare(`INSERT INTO performance_snapshots
    (id, athlete_id, snapshot_date, source, vo2max, prediction_5k_seconds, prediction_10k_seconds, prediction_half_seconds, prediction_marathon_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(snapshotId, athleteId, requiredDate(body.snapshotDate), requiredText(body.source, "source"), numberOrNull(body.vo2max), numberOrNull(body.prediction5kSeconds), numberOrNull(body.prediction10kSeconds), numberOrNull(body.predictionHalfSeconds), numberOrNull(body.predictionMarathonSeconds), nowIso()).run();
  await audit({ id: userId } as never, "create", "performance_snapshot", snapshotId, athleteId, { source: optionalText(body.source) });
}

async function submitFeedback(userId: string, athleteId: string, body: Record<string, unknown>) {
  const feedbackId = id("feedback");
  await platformEnv().DB.prepare("INSERT INTO athlete_feedback (id, athlete_id, feedback_date, activity_id, rpe, legs, fatigue, sleep, pain, comments, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(feedbackId, athleteId, optionalText(body.feedbackDate) ?? todayIso(), optionalText(body.activityId), numberOrNull(body.rpe), numberOrNull(body.legs), numberOrNull(body.fatigue), numberOrNull(body.sleep), optionalText(body.pain), optionalText(body.comments), userId, nowIso()).run();
  await audit({ id: userId } as never, "submit", "feedback", feedbackId, athleteId, { painReported: Boolean(optionalText(body.pain)) });
  const pain = optionalText(body.pain); const fatigue = numberOrNull(body.fatigue);
  if (pain) await queueCoachAlert(athleteId, "pain", "Athlete reported pain", pain);
  else if (fatigue !== null && fatigue >= 8) await queueCoachAlert(athleteId, "fatigue", "Athlete fatigue needs review", `The athlete reported fatigue ${fatigue}/10 in today's check-in.`);
  if (pain || (fatigue !== null && fatigue >= 8)) await processPendingWork(athleteId);
}

async function completeOnboarding(userId: string, athleteId: string, body: Record<string, unknown>) {
  const db = platformEnv().DB; const timestamp = nowIso();
  const availability = { preferredTrainingDays: optionalText(body.preferredTrainingDays), scheduleNotes: optionalText(body.scheduleNotes) };
  await db.prepare(`UPDATE athletes SET weekly_target_km = ?, injury_notes = ?, experience_level = ?, training_days = ?, long_run_day = ?, availability_json = ?, onboarding_completed_at = ?, updated_at = ? WHERE id = ?`)
    .bind(numberOrNull(body.weeklyTargetKm), optionalText(body.injuryNotes), optionalText(body.experienceLevel), numberOrNull(body.trainingDays), optionalText(body.longRunDay), JSON.stringify(availability), timestamp, timestamp, athleteId).run();
  if (optionalText(body.goalTitle) && optionalText(body.eventDate)) await saveGoal(userId, athleteId, { title: body.goalTitle, eventDate: body.eventDate, distanceKm: body.distanceKm, goalTimeSeconds: body.goalTimeSeconds, priority: "A", notes: body.goalNotes });
  await audit({ id: userId } as never, "complete", "athlete_onboarding", athleteId, athleteId);
}

async function saveCoachNote(userId: string, athleteId: string, body: Record<string, unknown>) {
  const noteId = id("note");
  await platformEnv().DB.prepare("INSERT INTO coach_notes (id, athlete_id, coach_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(noteId, athleteId, userId, requiredText(body.note, "note"), nowIso()).run();
  await audit({ id: userId } as never, "create", "coach_note", noteId, athleteId);
}

async function updateAthlete(userId: string, athleteId: string, body: Record<string, unknown>) {
  await platformEnv().DB.prepare("UPDATE athletes SET display_name = COALESCE(?, display_name), weekly_target_km = COALESCE(?, weekly_target_km), injury_notes = ?, availability_json = COALESCE(?, availability_json), updated_at = ? WHERE id = ?")
    .bind(optionalText(body.displayName), numberOrNull(body.weeklyTargetKm), optionalText(body.injuryNotes), body.availability ? JSON.stringify(body.availability) : null, nowIso(), athleteId).run();
  await audit({ id: userId } as never, "update", "athlete", athleteId, athleteId);
}

async function generatePlan(userId: string, athleteId: string) {
  const db = platformEnv().DB;
  const athlete = await db.prepare("SELECT * FROM athletes WHERE id = ?").bind(athleteId).first<Record<string, unknown>>();
  const goal = await db.prepare("SELECT * FROM goals WHERE athlete_id = ? AND status = 'active' ORDER BY CASE priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END, event_date LIMIT 1").bind(athleteId).first<Record<string, unknown>>();
  if (!athlete || !goal) throw new Error("Add an active goal before generating a plan.");
  const latestTest = await db.prepare("SELECT * FROM lactate_tests WHERE athlete_id = ? ORDER BY test_date DESC LIMIT 1").bind(athleteId).first<Record<string, unknown>>();
  const recentFeedback = await db.prepare("SELECT * FROM athlete_feedback WHERE athlete_id = ? ORDER BY feedback_date DESC, created_at DESC LIMIT 1").bind(athleteId).first<Record<string, unknown>>();
  const activities = await db.prepare("SELECT * FROM activities WHERE athlete_id = ? ORDER BY activity_date DESC LIMIT 80").bind(athleteId).all<Record<string, unknown>>();
  const generated = await generateTrainingPlan({ athlete, goal, latestTest, recentFeedback, recentActivities: activities.results ?? [] });
  const versionRow = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM training_plans WHERE athlete_id = ?").bind(athleteId).first<{ version: number }>();
  const version = Number(versionRow?.version ?? 0) + 1; const planId = id("plan"); const timestamp = nowIso();
  await db.prepare("INSERT INTO training_plans (id, athlete_id, goal_id, version, status, start_date, end_date, rationale, created_by, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)")
    .bind(planId, athleteId, goal.id, version, generated.sessions[0]?.date ?? todayIso(), generated.sessions.at(-1)?.date ?? String(goal.event_date), generated.rationale, userId, timestamp).run();
  for (let index = 0; index < generated.sessions.length; index += 30) {
    await db.batch(generated.sessions.slice(index, index + 30).map((session) => db.prepare("INSERT INTO planned_sessions (id, plan_id, athlete_id, session_date, workout_type, title, details, planned_distance_km, pace_guidance, hr_guidance, purpose, fatigue_modification, major_stimulus, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')")
      .bind(id("session"), planId, athleteId, session.date, session.workoutType, session.title, session.details, session.distanceKm, session.paceGuidance, session.hrGuidance, session.purpose, session.fatigueModification, session.majorStimulus ? 1 : 0)));
  }
  await audit({ id: userId } as never, "generate", "training_plan", planId, athleteId, { version, sessions: generated.sessions.length });
}

async function publishPlan(userId: string, athleteId: string, planId: string) {
  const db = platformEnv().DB; const plan = await db.prepare("SELECT * FROM training_plans WHERE id = ? AND athlete_id = ? AND status = 'draft'").bind(planId, athleteId).first<Record<string, unknown>>();
  if (!plan) throw new Error("Only a draft plan can be published.");
  const athlete = await db.prepare("SELECT email, display_name FROM athletes WHERE id = ?").bind(athleteId).first<{ email: string | null; display_name: string }>();
  const timestamp = nowIso();
  await db.batch([
    db.prepare("UPDATE training_plans SET status = 'archived' WHERE athlete_id = ? AND status = 'published'").bind(athleteId),
    db.prepare("UPDATE training_plans SET status = 'published', published_at = ? WHERE id = ?").bind(timestamp, planId),
    ...(athlete?.email ? [db.prepare("INSERT INTO notifications (id, athlete_id, recipient_email, notification_type, subject, body, status, created_at) VALUES (?, ?, ?, 'plan_published', ?, ?, 'queued', ?)").bind(id("notification"), athleteId, athlete.email, "Your training plan has been updated", `${athlete.display_name}, your coach published plan version ${plan.version}. Sign in to your private dashboard to review the sessions and guidance.`, timestamp)] : []),
  ]);
  await audit({ id: userId } as never, "publish", "training_plan", planId, athleteId, { version: plan.version });
}

async function queuePipeline(userId: string, athleteId: string) {
  const timestamp = nowIso(); const key = `intervals_sync:${athleteId}:${timestamp.slice(0, 13)}`;
  await platformEnv().DB.prepare("INSERT OR IGNORE INTO jobs (id, athlete_id, job_type, status, idempotency_key, payload_json, scheduled_at) VALUES (?, ?, 'intervals_sync', 'queued', ?, '{}', ?)")
    .bind(id("job"), athleteId, key, timestamp).run();
  await audit({ id: userId } as never, "queue", "pipeline", key, athleteId);
}

async function disconnectIntervals(userId: string, athleteId: string) {
  const db = platformEnv().DB; const connection = await db.prepare("SELECT id, encrypted_access_token FROM data_connections WHERE athlete_id = ? AND provider = 'intervals'").bind(athleteId).first<Record<string, unknown>>();
  if (connection?.encrypted_access_token) {
    try {
      const token = await decryptSecret(String(connection.encrypted_access_token));
      await fetch("https://intervals.icu/api/v1/disconnect-app", { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    } catch { /* Local access is still removed even if remote revocation is unavailable. */ }
  }
  if (connection) await db.prepare("UPDATE data_connections SET status = 'disconnected', encrypted_access_token = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), connection.id).run();
  await audit({ id: userId } as never, "disconnect", "data_connection", String(connection?.id ?? "intervals"), athleteId);
}

function coachOnly(user: { role: string }) { if (user.role !== "coach") throw new Response("Coach access required.", { status: 403 }); }
function requiredText(value: unknown, label: string) { const text = String(value ?? "").trim(); if (!text) throw new Error(`${label} is required.`); return text; }
function optionalText(value: unknown) { const text = String(value ?? "").trim(); return text || null; }
function requiredDate(value: unknown) { const text = requiredText(value, "date"); if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Use a valid date."); return text; }
function numberOrNull(value: unknown) { if (value === "" || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function requiredNumber(value: unknown, label: string) { const parsed = numberOrNull(value); if (parsed === null) throw new Error(`${label} is required.`); return parsed; }
function apiError(error: unknown) { if (error instanceof Response) return error; const message = error instanceof Error ? error.message : "Unexpected workspace error."; return Response.json({ error: message }, { status: 400 }); }
