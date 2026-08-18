import { NextRequest } from "next/server";
import { requireApiUser, requireAthleteAccess } from "../../../../lib/auth";
import { id, platformEnv } from "../../../../db/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    if (user.role !== "coach") return new Response("Coach access required.", { status: 403 });
    const athleteId = request.nextUrl.searchParams.get("athleteId");
    if (!athleteId) return new Response("Athlete is required.", { status: 400 });
    await requireAthleteAccess(user, athleteId, false);
    const runtime = platformEnv();
    if (!runtime.INTERVALS_CLIENT_ID || !runtime.INTERVALS_REDIRECT_URI || !runtime.INTERVALS_CLIENT_SECRET || !runtime.CONNECTION_ENCRYPTION_KEY) {
      return new Response("Intervals.icu OAuth is not configured yet.", { status: 503 });
    }
    const state = id("oauth"); const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    await runtime.DB.prepare("INSERT INTO oauth_states (state, athlete_id, user_id, expires_at) VALUES (?, ?, ?, ?)").bind(state, athleteId, user.id, expires).run();
    const target = new URL("https://intervals.icu/oauth/authorize");
    target.searchParams.set("client_id", runtime.INTERVALS_CLIENT_ID);
    target.searchParams.set("redirect_uri", runtime.INTERVALS_REDIRECT_URI);
    target.searchParams.set("scope", "ACTIVITY:READ,WELLNESS:READ");
    target.searchParams.set("state", state);
    return Response.redirect(target);
  } catch (error) { return error instanceof Response ? error : new Response(error instanceof Error ? error.message : "Connection failed.", { status: 400 }); }
}
