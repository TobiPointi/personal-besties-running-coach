import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "./supabase";

export interface Profile {
  id: string;
  name: string;
  role: "coach" | "athlete";
}

interface AuthState {
  profile: Profile | null;
  loading: boolean;
  /** null in demo mode (no Supabase configured) */
  userId: string | null;
  isCoach: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, name: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  profile: null,
  loading: false,
  userId: null,
  isCoach: false,
  signIn: async () => null,
  signUp: async () => null,
  signOut: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setLoading(false);
      return;
    }
    const load = async (userId: string | undefined) => {
      if (!userId) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data } = await sb.from("profiles").select("*").eq("id", userId).single();
      setProfile(data ?? null);
      setLoading(false);
    };

    sb.auth.getSession().then(({ data }) => load(data.session?.user.id));

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      load(session?.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthState["signIn"] = async (email, password) => {
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };

  const signUp: AuthState["signUp"] = async (email, password, name) => {
    const { error } = await supabase!.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    return error ? error.message : null;
  };

  const signOut = async () => {
    await supabase!.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        profile,
        loading,
        userId: profile?.id ?? null,
        isCoach: profile?.role === "coach",
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
