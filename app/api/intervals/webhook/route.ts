import { NextRequest } from "next/server";
import { id, nowIso, platformEnv } from "../../../../db/runtime";
import { processPendingWork } from "../../../../lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const runtime = platformEnv();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const supplied = request.headers.get("x-webhook-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? String(body.secret ?? "");
  if (!runtime.INTERVALS_WEBHOOK_SECRET || supplied !== runtime.INTERVALS_WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
  const externalId = String(body.athlete_id ?? body.athleteId ?? "");
  const connection = await runtime.DB.prepare("SELECT athlete_id FROM data_connections WHERE provider = 'intervals' AND external_athlete_id = ? AND status = 'active'").bind(externalId).first<{ athlete_id:string }>();
  if (!connection) return Response.json({ ok:true, ignored:true });
  const timestamp = nowIso(); const eventType = String(body.type ?? "activity").toLowerCase();
  await runtime.DB.prepare("INSERT OR IGNORE INTO jobs (id, athlete_id, job_type, status, idempotency_key, payload_json, scheduled_at) VALUES (?, ?, 'intervals_sync', 'queued', ?, ?, ?)")
    .bind(id("job"), connection.athlete_id, `intervals_webhook:${connection.athlete_id}:${eventType}:${timestamp.slice(0,16)}`, JSON.stringify({ eventType }), timestamp).run();
  await processPendingWork(connection.athlete_id);
  return Response.json({ ok:true });
}
