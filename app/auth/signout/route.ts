import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase";

export async function GET(request: NextRequest) {
  const client = await createServerSupabaseClient();
  if (client) {
    const { data } = await client.auth.getUser();
    if (data.user) { await client.auth.signOut(); return NextResponse.redirect(new URL("/", request.url)); }
  }
  if (request.headers.get("oai-authenticated-user-id")) return NextResponse.redirect(new URL("/signout-with-chatgpt?return_to=/", request.url));
  return NextResponse.redirect(new URL("/", request.url));
}
