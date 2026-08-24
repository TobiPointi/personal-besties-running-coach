import DashboardClient from "./DashboardClient";
import AuthScreen from "./AuthScreen";
import { currentUser } from "../lib/auth";
import { supabaseConfig } from "../lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  return user ? <DashboardClient /> : <AuthScreen config={supabaseConfig()} />;
}
