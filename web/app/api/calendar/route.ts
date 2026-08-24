import { NextRequest } from "next/server";
import { requireApiUser, requireAthleteAccess } from "../../../lib/auth";
import { platformEnv } from "../../../db/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(); const athleteId = request.nextUrl.searchParams.get("athleteId");
    if (!athleteId) return new Response("Athlete is required.", { status: 400 });
    await requireAthleteAccess(user, athleteId, false);
    const db = platformEnv().DB;
    const athlete = await db.prepare("SELECT display_name FROM athletes WHERE id = ?").bind(athleteId).first<{ display_name: string }>();
    const plan = await db.prepare("SELECT id, version FROM training_plans WHERE athlete_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1").bind(athleteId).first<{ id: string; version: number }>();
    if (!athlete || !plan) return new Response("No published plan is available.", { status: 404 });
    const result = await db.prepare("SELECT * FROM planned_sessions WHERE plan_id = ? ORDER BY session_date").bind(plan.id).all<Record<string, unknown>>();
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Personal Besties//Private Training Plan//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeIcs(`${athlete.display_name} training plan`)}`];
    for (const session of result.results ?? []) {
      lines.push("BEGIN:VEVENT", `UID:${session.id}@personalbesties`, `DTSTART;VALUE=DATE:${String(session.session_date).replaceAll("-", "")}`, `SUMMARY:${escapeIcs(`${session.title}${session.planned_distance_km ? ` — ${session.planned_distance_km} km` : ""}`)}`, `DESCRIPTION:${escapeIcs([session.details, `Pace: ${session.pace_guidance ?? ""}`, `Purpose: ${session.purpose ?? ""}`, `If fatigued: ${session.fatigue_modification ?? ""}`].join("\n"))}`, "STATUS:CONFIRMED", "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return new Response(`${lines.join("\r\n")}\r\n`, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="personal-besties-plan-v${plan.version}.ics"`, "cache-control": "private, no-store" } });
  } catch (error) { return error instanceof Response ? error : new Response("Calendar export failed.", { status: 400 }); }
}

function escapeIcs(value: string) { return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n"); }
