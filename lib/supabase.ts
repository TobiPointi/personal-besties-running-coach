import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { platformEnv } from "../db/runtime";

export function supabaseConfig() {
  const env = platformEnv();
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && publishableKey ? { url, publishableKey } : null;
}

export async function createServerSupabaseClient() {
  const config = supabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot always write refreshed cookies. Route handlers can.
        }
      },
    },
  });
}

export async function getSupabaseIdentity() {
  const client = await createServerSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase();
  if (error || !data.user || !email) return null;
  return { subject: data.user.id, email };
}
