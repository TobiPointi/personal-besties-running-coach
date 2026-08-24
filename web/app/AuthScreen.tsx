"use client";

import { createBrowserClient } from "@supabase/ssr";
import { FormEvent, useEffect, useState } from "react";

type Language = "en" | "de";
const OTP_LENGTH = 8;

const copy = {
  en: {
    tagline: "BETTER TOGETHER.", headline: <>Move together.<br />Make it yours.</>,
    story: "A shared place for plans, progress, and the small wins that make training more fun.",
    access: "WELCOME BACK",
    title: "Sign in by email", intro: "Use your email to pick up where you left off.",
    email: "Email address", send: "Send me a code", sending: "Sending…", codeTitle: "Enter your sign-in code",
    codeIntro: "Enter the code from your newest Personal Besties email.", code: "Sign-in code",
    verify: "Sign in", verifying: "Signing in…", resend: "Use another email", remember: "Keep me signed in on this device",
    privacy: "Privacy & data use",
    sent: "Code sent. Check your inbox and spam folder.", sendError: "The sign-in code could not be sent. Please try again.",
    verifyError: "That code is invalid or expired. Request a fresh code and use the newest email.", unavailable: "Independent sign-in is currently unavailable.",
  },
  de: {
    tagline: "GEMEINSAM BESSER.", headline: <>Gemeinsam los.<br />Ganz du selbst.</>,
    story: "Ein gemeinsamer Ort für Pläne, Fortschritt und die kleinen Erfolge, die Training noch schöner machen.",
    access: "WILLKOMMEN ZURÜCK",
    title: "Mit E-Mail anmelden", intro: "Nutze deine E-Mail und mach dort weiter, wo du aufgehört hast.",
    email: "E-Mail-Adresse", send: "Code senden", sending: "Wird gesendet…", codeTitle: "Anmeldecode eingeben",
    codeIntro: "Gib den Code aus deiner neuesten Personal-Besties-E-Mail ein.", code: "Anmeldecode",
    verify: "Anmelden", verifying: "Anmeldung…", resend: "Andere E-Mail verwenden", remember: "Auf diesem Gerät angemeldet bleiben",
    privacy: "Datenschutz & Datennutzung",
    sent: "Code gesendet. Prüfe auch den Spam-Ordner.", sendError: "Der Anmeldecode konnte nicht gesendet werden. Bitte erneut versuchen.",
    verifyError: "Der Code ist ungültig oder abgelaufen. Fordere einen neuen an und verwende die neueste E-Mail.", unavailable: "Die unabhängige Anmeldung ist derzeit nicht verfügbar.",
  },
};

export default function AuthScreen({ config }: { config: { url: string; publishableKey: string } | null }) {
  const [language, setLanguage] = useState<Language>("en");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const text = copy[language];

  useEffect(() => {
    const saved = window.localStorage.getItem("pb-language");
    if (saved === "de" || saved === "en") setLanguage(saved);
  }, []);

  function changeLanguage(next: Language) {
    setLanguage(next); window.localStorage.setItem("pb-language", next); document.documentElement.lang = next;
  }

  function client() {
    if (!config) return null;
    return createBrowserClient(config.url, config.publishableKey, {
      isSingleton: false,
      cookieOptions: { path: "/", sameSite: "lax", secure: true, maxAge: remember ? 400 * 24 * 60 * 60 : undefined },
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true },
    });
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const auth = client(); if (!auth) return;
    setBusy(true); setMessage("");
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await auth.auth.signInWithOtp({ email: normalizedEmail, options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setMessage(text.sendError); else { setEmail(normalizedEmail); setStep("code"); setMessage(text.sent); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const auth = client(); if (!auth) return;
    setBusy(true); setMessage("");
    const { error } = await auth.auth.verifyOtp({ email, token: code.replace(/\D/g, ""), type: "email" });
    if (error) { setBusy(false); setMessage(text.verifyError); return; }
    window.location.assign("/");
  }

  return <main className="auth-page">
    <div className="language-switch auth-language" aria-label="Language"><button className={language === "de" ? "active" : ""} onClick={() => changeLanguage("de")}>DE</button><button className={language === "en" ? "active" : ""} onClick={() => changeLanguage("en")}>EN</button></div>
    <section className="auth-story"><div className="brand auth-brand"><img className="brand-logo auth-brand-logo" src="/personal-besties-logo-placeholder.png" alt="Personal Besties" /></div><div className="auth-story-copy"><p className="eyebrow">{text.tagline}</p><h1>{text.headline}</h1><p>{text.story}</p></div><div className="auth-story-footer">personal besties · run, move, belong</div></section>
    <section className="auth-panel"><form className="auth-card" onSubmit={step === "email" ? requestCode : verifyCode}><p className="eyebrow">{text.access}</p><h2>{step === "email" ? text.title : text.codeTitle}</h2><p>{step === "email" ? text.intro : text.codeIntro}</p>
      {step === "email" ? <label className="field"><span>{text.email}</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label> : <label className="field otp-field"><span>{text.code}</span><input inputMode="numeric" autoComplete="one-time-code" pattern={`[0-9]{${OTP_LENGTH}}`} maxLength={OTP_LENGTH} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))} placeholder={"0".repeat(OTP_LENGTH)} /></label>}
      <label className="remember-field"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> {text.remember}</label>
      <button className="primary-button auth-submit" disabled={busy || !config || (step === "code" && code.length !== OTP_LENGTH)}>{busy ? (step === "email" ? text.sending : text.verifying) : (step === "email" ? text.send : text.verify)}</button>
      {!config && <p className="auth-notice">{text.unavailable}</p>}{message && <p className="auth-notice" role="status">{message}</p>}{step === "code" && <button type="button" className="text-button auth-back" onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>{text.resend}</button>}</form>
      <a className="auth-privacy" href="/privacy">{text.privacy}</a>
    </section>
  </main>;
}
