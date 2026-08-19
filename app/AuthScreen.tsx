"use client";

import { createBrowserClient } from "@supabase/ssr";
import { FormEvent, useMemo, useState } from "react";

export default function AuthScreen({ config }: { config: { url: string; publishableKey: string } | null }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const client = useMemo(() => config ? createBrowserClient(config.url, config.publishableKey, { auth: { flowType: "pkce" } }) : null, [config]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setBusy(true); setMessage("");
    const { error } = await client.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
    });
    setBusy(false);
    setMessage(error ? "The sign-in email could not be sent. Please try again." : "Check your inbox. The secure link expires automatically and can only be used once.");
  }

  return <main className="auth-page">
    <section className="auth-story"><div className="brand auth-brand"><span className="brand-mark">A</span><span>Athelon</span></div><div><p className="eyebrow">TRAINING, IN CONTEXT.</p><h1>One workspace.<br />Every athlete, understood.</h1><p>Plans, lactate testing, recovery signals and coach feedback—kept private for each athlete.</p></div><div className="auth-proof"><span>Invite only</span><span>Passwordless</span><span>Coach reviewed</span></div></section>
    <section className="auth-panel"><form className="auth-card" onSubmit={submit}><p className="eyebrow">PRIVATE ACCESS</p><h2>Sign in by email</h2><p>No ChatGPT account and no password required. Use the email address your coach invited.</p><label className="field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button className="primary-button auth-submit" disabled={busy || !config}>{busy ? "Sending…" : "Email me a secure link"}</button>{!config && <p className="auth-notice">Independent sign-in is being connected. Your existing private access remains available during the transition.</p>}{message && <p className="auth-notice" role="status">{message}</p>}<small>Only invited addresses receive access to athlete records. Signing in never exposes another athlete’s dashboard.</small></form>
    </section>
  </main>;
}
