import { getChatGPTUser } from "../app/chatgpt-auth";
import { ensureSchema, nowIso, platformEnv } from "../db/runtime";
import { getSupabaseIdentity } from "./supabase";

export type AppUser = { id: string; email: string; displayName: string; role: "coach" | "athlete" };

export async function currentUser(): Promise<AppUser | null> {
  const db = platformEnv().DB;
  await ensureSchema(db);
  const externalIdentity = await getSupabaseIdentity();
  if (externalIdentity) return resolveIdentity("supabase", externalIdentity.subject, externalIdentity.email);

  const platformUser = await getChatGPTUser();
  const isDevelopment = process.env.NODE_ENV !== "production";
  if (!platformUser && !isDevelopment) return null;

  const identity = platformUser ?? {
    userId: "local-coach",
    email: "tobias@local.preview",
    displayName: "Tobias Pointner",
    fullName: "Tobias Pointner",
  };
  return resolveIdentity("chatgpt", identity.userId, identity.email, identity.displayName);
}

async function resolveIdentity(provider: "supabase" | "chatgpt", subject: string, email: string, displayName?: string): Promise<AppUser | null> {
  const db = platformEnv().DB;
  const normalizedEmail = email.trim().toLowerCase();
  const mapping = await db.prepare(`SELECT u.id, u.email, u.display_name AS displayName, u.role
    FROM auth_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.provider = ? AND ai.provider_subject = ?`)
    .bind(provider, subject).first<AppUser>();
  if (mapping) {
    await db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(nowIso(), mapping.id).run();
    return mapping;
  }

  const direct = await db.prepare("SELECT id, email, display_name AS displayName, role FROM users WHERE id = ? OR lower(email) = lower(?) LIMIT 1")
    .bind(subject, normalizedEmail).first<AppUser>();
  if (direct) {
    await db.batch([
      db.prepare("INSERT OR REPLACE INTO auth_identities (provider, provider_subject, user_id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM auth_identities WHERE provider = ? AND provider_subject = ?), ?), ?)")
        .bind(provider, subject, direct.id, normalizedEmail, provider, subject, nowIso(), nowIso()),
      db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(nowIso(), direct.id),
    ]);
    return direct;
  }

  const invited = await db.prepare(`SELECT i.athlete_id AS athleteId, a.display_name AS displayName
    FROM invitations i JOIN athletes a ON a.id = i.athlete_id
    WHERE lower(i.email) = lower(?) AND i.status = 'pending' ORDER BY i.created_at DESC LIMIT 1`)
    .bind(normalizedEmail).first<{ athleteId: string; displayName: string }>();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  const mayBootstrapCoach = Number(count?.count ?? 0) === 0;
  if (!invited && !mayBootstrapCoach) return null;

  const timestamp = nowIso();
  const userId = mayBootstrapCoach ? subject : `user_${crypto.randomUUID().replaceAll("-", "")}`;
  const role: "coach" | "athlete" = mayBootstrapCoach ? "coach" : "athlete";
  const resolvedName = invited?.displayName ?? displayName ?? normalizedEmail.split("@")[0];
  const statements = [
    db.prepare("INSERT INTO users (id, email, display_name, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(userId, normalizedEmail, resolvedName, role, timestamp, timestamp),
    db.prepare("INSERT INTO auth_identities (provider, provider_subject, user_id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(provider, subject, userId, normalizedEmail, timestamp, timestamp),
  ];
  if (invited) statements.push(
    db.prepare("UPDATE athletes SET user_id = ?, status = 'active', updated_at = ? WHERE id = ?").bind(userId, timestamp, invited.athleteId),
    db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE athlete_id = ? AND lower(email) = lower(?)").bind(timestamp, invited.athleteId, normalizedEmail),
  );
  await db.batch(statements);
  return { id: userId, email: normalizedEmail, displayName: resolvedName, role };
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
