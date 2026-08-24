import { useEffect, useMemo, useState } from "react";
import { LactateTestResult } from "./components/lactate/LactateTestResult";
import { ChangeRequestsInbox, TrainingPlan } from "./components/training/TrainingPlan";
import { AuthForm } from "./components/AuthForm";
import { AuthProvider, useAuth } from "./lib/auth";
import { supabase } from "./lib/supabase";
import { store } from "./lib/trainingStore";
import { latestTest, previousTest } from "./data/lactateTests";
import { toLactateTestResultData } from "./utils/lactateAdapter";

type Tab = "plan" | "lactate" | "requests";

function Shell() {
  const { profile, loading, userId, isCoach, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("plan");
  const [athleteId, setAthleteId] = useState<string>("");
  const [athleteIds, setAthleteIds] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!supabase) return;
    store.listSessions().then((sessions) => {
      const map = new Map<string, string>();
      for (const s of sessions) map.set(s.athleteId, s.athleteName);
      setAthleteIds([...map.entries()].map(([id, name]) => ({ id, name })));
    });
  }, []);

  useEffect(() => {
    if (!athleteId && userId) setAthleteId(userId);
  }, [userId, athleteId]);

  const result = useMemo(() => toLactateTestResultData(latestTest), []);
  const previous = useMemo(() => toLactateTestResultData(previousTest), []);

  if (!supabase) {
    return (
      <>
        <Nav tab={tab} setTab={setTab} isCoach={true} onSignOut={undefined} demo />
        {tab === "plan" && <TrainingPlan athleteId="tobias" />}
        {tab === "lactate" && <LactateTestResult data={result} previousTest={previous} />}
        {tab === "requests" && <ChangeRequestsInbox />}
      </>
    );
  }

  if (loading) return <div style={{ textAlign: "center", padding: 64, color: "#6e7787" }}>Loading…</div>;
  if (!profile) return <AuthForm />;

  const effectiveAthleteId = isCoach ? athleteId || userId! : userId!;

  return (
    <>
      <Nav tab={tab} setTab={setTab} isCoach={isCoach} onSignOut={signOut}>
        {isCoach && (
          <label className="coach-select">
            Athlete
            <select value={effectiveAthleteId} onChange={(e) => setAthleteId(e.target.value)}>
              {athleteIds.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              {!athleteIds.some((a) => a.id === effectiveAthleteId) && (
                <option value={effectiveAthleteId}>{profile.name}</option>
              )}
            </select>
          </label>
        )}
      </Nav>
      {tab === "plan" && <TrainingPlan athleteId={effectiveAthleteId} />}
      {tab === "lactate" && <LactateTestResult data={result} previousTest={previous} />}
      {tab === "requests" && isCoach && <ChangeRequestsInbox />}
    </>
  );
}

function Nav({
  tab,
  setTab,
  isCoach,
  onSignOut,
  demo,
  children,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  isCoach: boolean;
  onSignOut?: () => void;
  demo?: boolean;
  children?: React.ReactNode;
}) {
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "plan", label: "Training plan" },
    { id: "lactate", label: "Lactate test" },
    ...(isCoach ? [{ id: "requests" as const, label: "Requests" }] : []),
  ];
  return (
    <nav
      style={{
        maxWidth: 1080,
        margin: "0 auto 16px",
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tab === t.id}
          onClick={() => setTab(t.id)}
          style={{
            border: "1px solid " + (tab === t.id ? "#1b2437" : "#e8e6e0"),
            background: tab === t.id ? "#1b2437" : "#fff",
            color: tab === t.id ? "#fff" : "#6e7787",
            borderRadius: 999,
            padding: "6px 16px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      {children}
      {demo && (
        <span
          style={{
            fontSize: 12,
            color: "#997a00",
            background: "#fff9db",
            border: "1px solid #ffe066",
            borderRadius: 999,
            padding: "4px 12px",
          }}
        >
          Demo mode
        </span>
      )}
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          style={{
            border: "1px solid #e8e6e0",
            background: "#fff",
            color: "#6e7787",
            borderRadius: 999,
            padding: "6px 16px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      )}
    </nav>
  );
}

export default function App() {
  return (
    <main style={{ padding: "32px 16px", background: "#f3f2ee", minHeight: "100vh" }}>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </main>
  );
}
