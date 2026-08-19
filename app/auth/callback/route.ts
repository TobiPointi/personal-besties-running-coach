import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const client = await createServerSupabaseClient();
  if (code && client) await client.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL("/", request.url));
}
