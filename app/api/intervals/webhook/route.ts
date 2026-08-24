import { NextRequest } from "next/server";
import { id, nowIso, platformEnv } from "../../../../db/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const runtime = platformEnv();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const supplied = request.headers.get("x-webhook-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? String(body.secret ?? "");
  if (!runtime.INTERVALS_WEBHOOK_SECRET || supplied !== runtime.INTERVALS_WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
  const rawEvents = Array.isArray(body.events) ? body.events : [body];
  const events = rawEvents.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object");
  const timestamp = nowIso();
  let queued = 0;

  for (const event of events) {
    const externalId = String(event.athlete_id ?? event.athleteId ?? "");
    if (!externalId) continue;
    const connection = await runtime.DB.prepare("SELECT athlete_id FROM data_connections WHERE provider = 'intervals' AND external_athlete_id = ? AND status = 'active'")
      .bind(externalId).first<{ athlete_id:string }>();
    if (!connection) continue;
    const eventType = String(event.type ?? event.event_type ?? "activity").toLowerCase();
    const activity = event.activity && typeof event.activity === "object" ? event.activity as Record<string, unknown> : null;
    const eventId = String(event.id ?? event.event_id ?? event.activity_id ?? activity?.id ?? `${eventType}:${event.timestamp ?? timestamp}`);
    const result = await runtime.DB.prepare("INSERT OR IGNORE INTO jobs (id, athlete_id, job_type, status, idempotency_key, payload_json, scheduled_at) VALUES (?, ?, 'intervals_sync', 'queued', ?, ?, ?)")
      .bind(id("job"), connection.athlete_id, `intervals_webhook:${connection.athlete_id}:${eventId}`, JSON.stringify({ eventType, eventId }), timestamp).run();
    if (result.meta.changes > 0) queued += 1;
  }

  // Acknowledge immediately. The outer Worker schedules /api/cron with
  // ExecutionContext.waitUntil so Intervals.icu never waits on a full import.
  return Response.json({ ok:true, received: events.length, queued, ignored: events.length - queued });
}
