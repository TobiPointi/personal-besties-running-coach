"use client";

import { createBrowserClient } from "@supabase/ssr";
import { FormEvent, useEffect, useState } from "react";

type Language = "en" | "de";

const copy = {
  en: {
    tagline: "BETTER TOGETHER.", headline: <>Train with context.<br />Improve with friends.</>,
    story: "Private coaching, lactate testing, recovery signals and thoughtful plans—shared with the people helping you get better.",
    invite: "Invite only", passwordless: "Passwordless", reviewed: "Coach reviewed", access: "PRIVATE ACCESS",
    title: "Sign in by email", intro: "No ChatGPT account and no password required. Use the email address your coach invited.",
    email: "Email address", send: "Email me a 6-digit code", sending: "Sending…", codeTitle: "Enter your sign-in code",
    codeIntro: "Enter the 6-digit code from the newest Personal Besties email. No link needs to be opened.", code: "6-digit code",
    verify: "Sign in", verifying: "Signing in…", resend: "Use another email", remember: "Keep me signed in on this device",
    safe: "Only invited addresses receive access. Signing in never exposes another athlete’s dashboard.", privacy: "Privacy & data use",
    sent: "Code sent. Check your inbox and spam folder.", sendError: "The sign-in code could not be sent. Please try again.",
    verifyError: "That code is invalid or expired. Request a fresh code and use the newest email.", unavailable: "Independent sign-in is currently unavailable.",
  },
  de: {
    tagline: "GEMEINSAM BESSER.", headline: <>Trainiere mit Kontext.<br />Wachse mit Freunden.</>,
    story: "Privates Coaching, Laktattests, Erholungssignale und durchdachte Pläne—geteilt mit den Menschen, die dich besser machen.",
    invite: "Nur mit Einladung", passwordless: "Ohne Passwort", reviewed: "Vom Coach geprüft", access: "PRIVATER ZUGANG",
    title: "Mit E-Mail anmelden", intro: "Kein ChatGPT-Konto und kein Passwort nötig. Verwende die vom Coach eingeladene E-Mail-Adresse.",
    email: "E-Mail-Adresse", send: "6-stelligen Code senden", sending: "Wird gesendet…", codeTitle: "Anmeldecode eingeben",
    codeIntro: "Gib den 6-stelligen Code aus der neuesten Personal-Besties-E-Mail ein. Du musst keinen Link öffnen.", code: "6-stelliger Code",
    verify: "Anmelden", verifying: "Anmeldung…", resend: "Andere E-Mail verwenden", remember: "Auf diesem Gerät angemeldet bleiben",
    safe: "Nur eingeladene Adressen erhalten Zugriff. Andere Athleten-Dashboards bleiben immer verborgen.", privacy: "Datenschutz & Datennutzung",
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
    <section className="auth-story"><div className="brand auth-brand"><img className="brand-logo auth-brand-logo" src="/personal-besties-logo-placeholder.png" alt="Personal Besties" /></div><div><p className="eyebrow">{text.tagline}</p><h1>{text.headline}</h1><p>{text.story}</p></div><div className="auth-proof"><span>{text.invite}</span><span>{text.passwordless}</span><span>{text.reviewed}</span></div></section>
    <section className="auth-panel"><form className="auth-card" onSubmit={step === "email" ? requestCode : verifyCode}><p className="eyebrow">{text.access}</p><h2>{step === "email" ? text.title : text.codeTitle}</h2><p>{step === "email" ? text.intro : text.codeIntro}</p>
      {step === "email" ? <label className="field"><span>{text.email}</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label> : <label className="field otp-field"><span>{text.code}</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>}
      <label className="remember-field"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> {text.remember}</label>
      <button className="primary-button auth-submit" disabled={busy || !config || (step === "code" && code.length !== 6)}>{busy ? (step === "email" ? text.sending : text.verifying) : (step === "email" ? text.send : text.verify)}</button>
      {!config && <p className="auth-notice">{text.unavailable}</p>}{message && <p className="auth-notice" role="status">{message}</p>}{step === "code" && <button type="button" className="text-button auth-back" onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>{text.resend}</button>}<small>{text.safe}</small></form>
      <a className="auth-privacy" href="/privacy">{text.privacy}</a>
    </section>
  </main>;
}
