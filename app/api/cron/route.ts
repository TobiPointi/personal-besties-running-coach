import { NextRequest } from "next/server";
import { currentUser } from "../../../lib/auth";
import { processPendingWork } from "../../../lib/pipeline";
import { platformEnv } from "../../../db/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = platformEnv().CRON_SECRET;
  const authorizedCron = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const user = authorizedCron ? null : await currentUser();
  if (!authorizedCron && user?.role !== "coach") return new Response("Unauthorized", { status: 401 });
  return Response.json({ ok: true, ...(await processPendingWork()) });
}

export async function GET(request: NextRequest) { return POST(request); }
