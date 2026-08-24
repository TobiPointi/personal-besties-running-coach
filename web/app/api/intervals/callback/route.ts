import { NextRequest } from "next/server";
import { requireApiUser } from "../../../../lib/auth";
import { audit } from "../../../../lib/workspace";
import { encryptSecret } from "../../../../lib/secrets";
import { id, nowIso, platformEnv } from "../../../../db/runtime";
import { processPendingWork } from "../../../../lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const appOrigin = request.nextUrl.origin;
  try {
    const user = await requireApiUser();
    const code = request.nextUrl.searchParams.get("code"); const state = request.nextUrl.searchParams.get("state");
    const denied = request.nextUrl.searchParams.get("error");
    if (denied) return Response.redirect(`${appOrigin}/?connection=declined`);
    if (!code || !state) throw new Error("The authorization response is incomplete.");
    const runtime = platformEnv();
    const stored = await runtime.DB.prepare("SELECT athlete_id, user_id, expires_at FROM oauth_states WHERE state = ?").bind(state).first<{ athlete_id: string; user_id: string; expires_at: string }>();
    if (!stored || stored.user_id !== user.id || stored.expires_at < nowIso()) throw new Error("The authorization request expired or does not belong to this user.");
    const form = new URLSearchParams({ client_id: runtime.INTERVALS_CLIENT_ID ?? "", client_secret: runtime.INTERVALS_CLIENT_SECRET ?? "", code });
    const tokenResponse = await fetch("https://intervals.icu/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    if (!tokenResponse.ok) throw new Error(`Intervals.icu token exchange failed (${tokenResponse.status}).`);
    const token = await tokenResponse.json() as { access_token: string; scope?: string; athlete?: { id?: string; name?: string } };
    if (!token.access_token) throw new Error("Intervals.icu returned no access token.");
    const encrypted = await encryptSecret(token.access_token); const timestamp = nowIso(); const connectionId = id("connection");
    await runtime.DB.batch([
      runtime.DB.prepare(`INSERT INTO data_connections (id, athlete_id, provider, external_athlete_id, encrypted_access_token, scope, status, created_at, updated_at)
        VALUES (?, ?, 'intervals', ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(athlete_id, provider) DO UPDATE SET external_athlete_id=excluded.external_athlete_id, encrypted_access_token=excluded.encrypted_access_token, scope=excluded.scope, status='active', updated_at=excluded.updated_at`)
        .bind(connectionId, stored.athlete_id, token.athlete?.id ?? null, encrypted, token.scope ?? "ACTIVITY:READ,WELLNESS:READ", timestamp, timestamp),
      runtime.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state),
      runtime.DB.prepare("INSERT OR IGNORE INTO jobs (id, athlete_id, job_type, status, idempotency_key, payload_json, scheduled_at) VALUES (?, ?, 'intervals_sync', 'queued', ?, '{}', ?)").bind(id("job"), stored.athlete_id, `intervals_sync:${stored.athlete_id}:oauth:${state}`, timestamp),
    ]);
    await audit(user, "connect", "data_connection", connectionId, stored.athlete_id, { provider: "intervals", scope: token.scope });
    // A successful OAuth connection should show its available history immediately.
    // Failures are retained and retried by the job pipeline, rather than undoing OAuth.
    await processPendingWork(stored.athlete_id);
    return Response.redirect(`${appOrigin}/?athleteId=${encodeURIComponent(stored.athlete_id)}&connection=success`);
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Connection failed.");
    return Response.redirect(`${appOrigin}/?connection=error&message=${message}`);
  }
}
