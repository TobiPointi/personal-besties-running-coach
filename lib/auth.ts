import { getChatGPTUser } from "../app/chatgpt-auth";
import { ensureSchema, nowIso, platformEnv } from "../db/runtime";

export type AppUser = { id: string; email: string; displayName: string; role: "coach" | "athlete" };

export async function currentUser(): Promise<AppUser | null> {
  const platformUser = await getChatGPTUser();
  const isDevelopment = process.env.NODE_ENV !== "production";
  if (!platformUser && !isDevelopment) return null;

  const identity = platformUser ?? {
    userId: "local-coach",
    email: "tobias@local.preview",
    displayName: "Tobias Pointner",
    fullName: "Tobias Pointner",
  };
  const db = platformEnv().DB;
  await ensureSchema(db);
  const existing = await db.prepare("SELECT id, email, display_name AS displayName, role FROM users WHERE id = ?")
    .bind(identity.userId).first<AppUser>();
  if (existing) {
    await db.prepare("UPDATE users SET last_seen_at = ?, display_name = ? WHERE id = ?")
      .bind(nowIso(), identity.displayName, identity.userId).run();
    return existing;
  }

  const invited = await db.prepare("SELECT athlete_id AS athleteId FROM invitations WHERE lower(email) = lower(?) AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .bind(identity.email).first<{ athleteId: string }>();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  const role: "coach" | "athlete" = invited || Number(count?.count ?? 0) > 0 ? "athlete" : "coach";
  const timestamp = nowIso();
  await db.prepare("INSERT INTO users (id, email, display_name, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(identity.userId, identity.email.toLowerCase(), identity.displayName, role, timestamp, timestamp).run();
  if (invited) {
    await db.batch([
      db.prepare("UPDATE athletes SET user_id = ?, status = 'active', updated_at = ? WHERE id = ?").bind(identity.userId, timestamp, invited.athleteId),
      db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE athlete_id = ? AND lower(email) = lower(?)").bind(timestamp, invited.athleteId, identity.email),
    ]);
  }
  return { id: identity.userId, email: identity.email.toLowerCase(), displayName: identity.displayName, role };
}

export async function requireApiUser(): Promise<AppUser> {
  const user = await currentUser();
  if (!user) throw new Response("Authentication required", { status: 401 });
  return user;
}

export async function canAccessAthlete(user: AppUser, athleteId: string, write = false): Promise<boolean> {
  const db = platformEnv().DB;
  if (user.role === "coach") {
    const assignment = await db.prepare("SELECT 1 AS allowed FROM coach_athletes WHERE coach_user_id = ? AND athlete_id = ? AND status = 'active'")
      .bind(user.id, athleteId).first<{ allowed: number }>();
    return Boolean(assignment);
  }
  const athlete = await db.prepare("SELECT 1 AS allowed FROM athletes WHERE id = ? AND user_id = ?")
    .bind(athleteId, user.id).first<{ allowed: number }>();
  if (!athlete) return false;
  return !write;
}

export async function requireAthleteAccess(user: AppUser, athleteId: string, write = false): Promise<void> {
  if (!(await canAccessAthlete(user, athleteId, write))) throw new Response("You do not have access to this athlete.", { status: 403 });
}
