// Called by the app after an athlete creates a change request that needs
// coach approval. Emails the coach with approve/reject context.
// Required secrets: RESEND_API_KEY, COACH_EMAIL (plus MAIL_FROM optional).
import type { ChangeRequest } from "../../../src/types/training.ts";

const coachEmail = Deno.env.get("COACH_EMAIL")!;
const fromEmail = Deno.env.get("MAIL_FROM") ?? "coach@notifications.example";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }
  const r = (await req.json()) as Omit<ChangeRequest, "id" | "createdAt" | "status">;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: coachEmail,
      subject: `Approval needed: ${r.athleteName} wants to move "${r.sessionTitle}"`,
      html: `<p><b>${r.athleteName}</b> requested moving <b>${r.sessionTitle}</b> (${r.sessionType})</p>
             <p>${r.fromDate} → <b>${r.toDate}</b></p>
             <p style="color:#666">${r.reason ?? ""}</p>
             <p>Review it in the dashboard → Requests.</p>`,
    }),
  });

  return new Response(JSON.stringify({ ok: true }));
});
