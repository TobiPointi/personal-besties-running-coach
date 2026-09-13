// Nightly job: flags planned sessions before today as "missed" and emails
// a digest to the coach. Schedule daily (e.g. 21:00) via Supabase Dashboard
// -> Edge Functions -> schedule, or pg_cron + pg_net HTTP POST.
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, COACH_EMAIL
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const coachEmail = Deno.env.get("COACH_EMAIL")!;
const fromEmail = Deno.env.get("MAIL_FROM") ?? "coach@notifications.example";

interface SessionRow {
  id: string;
  athlete_name: string;
  date: string;
  title: string;
  type: string;
}

Deno.serve(async () => {
  const today = new Date().toISOString().slice(0, 10);

  const { data: missed, error } = await supabase
    .from("training_sessions")
    .select("id, athlete_name, date, title, type")
    .eq("status", "planned")
    .lt("date", today);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const rows = (missed ?? []) as SessionRow[];
  if (rows.length === 0) return new Response(JSON.stringify({ missed: 0 }));

  await supabase
    .from("training_sessions")
    .update({ status: "missed" })
    .in("id", rows.map((r) => r.id));

  const byAthlete = new Map<string, SessionRow[]>();
  for (const r of rows) {
    byAthlete.set(r.athlete_name, [...(byAthlete.get(r.athlete_name) ?? []), r]);
  }

  const lines = [...byAthlete.entries()].map(
    ([athlete, list]) =>
      `<li><b>${athlete}</b>: ${list.length} missed — ${list
        .map((s) => `${s.title} (${s.date})`)
        .join(", ")}</li>`,
  );

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: coachEmail,
      subject: `Missed trainings: ${rows.length} session${rows.length > 1 ? "s" : ""}`,
      html: `<p>The following planned sessions were not completed and are now marked as <b>missed</b>:</p><ul>${lines.join("")}</ul>`,
    }),
  });

  return new Response(JSON.stringify({ missed: rows.length }));
});
