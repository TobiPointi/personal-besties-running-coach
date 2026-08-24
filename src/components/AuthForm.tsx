import { useState } from "react";
import { useAuth } from "../lib/auth";
import "./auth.css";

export function AuthForm() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === "signin") {
      const err = await signIn(email, password);
      if (err) setError(err);
    } else {
      const err = await signUp(email, password, name || email.split("@")[0]);
      if (err) setError(err);
      else setNotice("Check your inbox to confirm your account, then sign in.");
    }
    setBusy(false);
  };

  return (
    <section className="auth-card" aria-label="Sign in">
      <h1 className="auth-title">Personal Besties Running Coach</h1>
      <div className="auth-segmented" role="group" aria-label="Sign in or sign up">
        <button type="button" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>
          Create account
        </button>
      </div>
      <form onSubmit={submit} className="auth-form">
        {mode === "signup" && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="auth-hint">
        The first account created becomes the coach account.
      </p>
    </section>
  );
}
