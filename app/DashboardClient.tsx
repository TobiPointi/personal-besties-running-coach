"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type AnyRow = Record<string, any>;
type WorkspaceState = {
  user: { id: string; email: string; displayName: string; role: "coach" | "athlete" };
  athletes: AnyRow[]; selectedAthlete: AnyRow | null; goals: AnyRow[]; tests: AnyRow[]; plans: AnyRow[];
  sessions: AnyRow[]; upcoming: AnyRow[]; activities: AnyRow[]; feedback: AnyRow[]; assessments: AnyRow[];
  connections: AnyRow[]; jobs: AnyRow[]; notifications: AnyRow[]; notes: AnyRow[]; metrics: AnyRow;
};
type Tab = "overview" | "plan" | "testing" | "goals" | "feedback" | "data";
type Modal = "invite" | "goal" | "test" | "feedback" | "profile" | null;

export default function DashboardClient() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const load = useCallback(async (athleteId?: string) => {
    const query = athleteId ? `?athleteId=${encodeURIComponent(athleteId)}` : "";
    const response = await fetch(`/api/workspace${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    setState(await response.json());
  }, []);

  useEffect(() => { load().catch((error) => setMessage({ tone: "bad", text: error.message })); }, [load]);

  async function act(action: string, payload: AnyRow = {}, success = "Saved") {
    if (!state?.selectedAthlete && action !== "inviteAthlete") return;
    setBusy(action); setMessage(null);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, athleteId: state?.selectedAthlete?.id, ...payload }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "The action could not be completed.");
      setState(result.state); setModal(null); setMessage({ tone: "good", text: success });
    } catch (error) { setMessage({ tone: "bad", text: error instanceof Error ? error.message : "Unexpected error" }); }
    finally { setBusy(""); }
  }

  if (!state) return <LoadingScreen message={message?.text} />;
  if (!state.selectedAthlete) return <EmptyWorkspace user={state.user} onInvite={() => setModal("invite")} modal={modal} close={() => setModal(null)} act={act} busy={busy} />;
  const athlete = state.selectedAthlete; const coach = state.user.role === "coach";
  const activeGoal = state.goals.find((goal) => goal.status === "active") ?? state.goals[0];
  const draft = state.plans.find((plan) => plan.status === "draft");
  const latestAssessment = state.assessments[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><span>Athelon</span></div>
        <nav aria-label="Workspace sections">
          <NavButton active={tab === "overview"} label="Overview" icon="⌂" onClick={() => setTab("overview")} />
          <NavButton active={tab === "plan"} label="Training plan" icon="□" onClick={() => setTab("plan")} />
          <NavButton active={tab === "testing"} label="Testing" icon="⌁" onClick={() => setTab("testing")} />
          <NavButton active={tab === "goals"} label="Goals" icon="◇" onClick={() => setTab("goals")} />
          <NavButton active={tab === "feedback"} label="Feedback" icon="◌" badge={state.feedback.length ? undefined : "1"} onClick={() => setTab("feedback")} />
          <NavButton active={tab === "data"} label="Data & delivery" icon="↻" onClick={() => setTab("data")} />
        </nav>
        {coach && <div className="athlete-list">
          <div className="section-label">YOUR ATHLETES <button onClick={() => setModal("invite")} aria-label="Invite athlete">+</button></div>
          {state.athletes.map((item) => <button className={`athlete-row ${item.id === athlete.id ? "selected" : ""}`} key={item.id} onClick={() => load(item.id)}>
            <span className="avatar">{initials(item.displayName)}</span><span><strong>{item.displayName}</strong><small>{athleteStatus(item, state)}</small></span><i aria-hidden="true" />
          </button>)}
        </div>}
        <div className="coach-profile"><span className="avatar dark">{initials(state.user.displayName)}</span><span><strong>{state.user.displayName.split(" ")[0]}</strong><small>{coach ? "Coach workspace" : "Athlete portal"}</small></span><a href="/auth/signout" aria-label="Sign out">↗</a></div>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">{coach ? "COACH WORKSPACE" : "ATHLETE DASHBOARD"}</p><h1>{coach ? `Good ${dayPart()}, ${state.user.displayName.split(" ")[0]}.` : "Your training, in context."}</h1></div>
          <div className="top-actions">{coach && <button className="primary-button" onClick={() => setModal("invite")}>+ Invite athlete</button>}</div>
        </header>
        {message && <div className={`toast ${message.tone}`}>{message.text}<button onClick={() => setMessage(null)}>×</button></div>}
        <section className="athlete-heading">
          <div className="athlete-title"><span className="avatar large">{initials(athlete.displayName)}</span><div><h2>{athlete.displayName}</h2><p>{activeGoal ? `${activeGoal.title} · ${state.metrics.daysToGoal} days to goal` : "No active goal yet"}</p></div></div>
          <div className="heading-actions">{connectionStatus(state.connections)}{coach && <button className="secondary-button" onClick={() => setModal("profile")}>Edit athlete</button>}</div>
        </section>

        {tab === "overview" && <Overview state={state} assessment={latestAssessment} onOpen={(next) => setTab(next)} />}
        {tab === "plan" && <PlanTab state={state} coach={coach} draft={draft} busy={busy} act={act} />}
        {tab === "testing" && <TestingTab state={state} coach={coach} onAdd={() => setModal("test")} />}
        {tab === "goals" && <GoalsTab state={state} coach={coach} onAdd={() => setModal("goal")} />}
        {tab === "feedback" && <FeedbackTab state={state} coach={coach} onAdd={() => setModal("feedback")} act={act} busy={busy} />}
        {tab === "data" && <DataTab state={state} coach={coach} busy={busy} act={act} />}
      </main>
      {modal && <ModalLayer modal={modal} athlete={athlete} close={() => setModal(null)} act={act} busy={busy} />}
    </div>
  );
}

function Overview({ state, assessment, onOpen }: { state: WorkspaceState; assessment?: AnyRow; onOpen: (tab: Tab) => void }) {
  const metrics = state.metrics; const attention = metrics.attention ?? [];
  return <>
    <section className="metric-grid" aria-label="Athlete summary">
      <article className="metric-card accent-card"><p>Race-day forecast</p><strong>{metrics.forecastLow ? `${formatDuration(metrics.forecastLow)}–${formatDuration(metrics.forecastHigh)}` : "Building evidence"}</strong><div className="metric-meta"><span className="pill positive">{assessment?.status?.replaceAll("_", " ") ?? "Needs data"}</span><small>{state.goals[0]?.goal_time_seconds ? `${formatDuration(state.goals[0].goal_time_seconds)} goal` : "No time goal"}</small></div></article>
      <article className="metric-card"><p>Training volume · 28 days</p><strong>{metrics.volume28Km || "—"} <em>KM</em></strong><div className="spark-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div><small className="delta">Fitness score {metrics.fitnessScore || "building"}</small></article>
      <article className="metric-card"><p>Recovery signal</p><strong>{metrics.recoveryStatus}</strong><div className="recovery-line"><span style={{ width: `${Math.max(8, 100 - Number(metrics.fatigueScore ?? 0))}%` }} /></div><small>Combine feedback, pain, sleep, and load</small></article>
      <article className="metric-card review-card"><p>Coach attention</p><strong>{attention.length}</strong>{attention.length ? attention.slice(0, 2).map((item: AnyRow) => <div key={item.label}><span className={`attention-dot ${item.level === "critical" ? "red" : "amber"}`} />{item.label}</div>) : <div><span className="attention-dot green" />No unresolved flags</div>}</article>
    </section>
    <div className="content-grid">
      <section className="panel schedule-panel"><div className="panel-header"><div><p className="eyebrow">PUBLISHED PLAN</p><h3>Next sessions</h3></div><button onClick={() => onOpen("plan")}>View full plan →</button></div><SessionList sessions={state.upcoming.slice(0, 6)} /></section>
      <aside className="right-column"><section className="panel readiness-panel"><div className="panel-header"><div><p className="eyebrow">COACHING SIGNALS</p><h3>Current context</h3></div><span className="pill positive">{metrics.recoveryStatus}</span></div>
        <div className="signal"><span>Latest test</span><b>{state.tests[0] ? formatDate(state.tests[0].test_date) : "—"}</b><em>{state.tests[0]?.confidence ?? "missing"}</em></div>
        <div className="signal"><span>Feedback</span><b>{state.feedback[0] ? formatDate(state.feedback[0].feedback_date) : "—"}</b><em>{state.feedback[0]?.fatigue ? `${state.feedback[0].fatigue}/10` : "none"}</em></div>
        <div className="signal"><span>Data source</span><b>{state.connections[0]?.provider ?? "Manual"}</b><em>{state.connections[0]?.last_sync_at ? "current" : "setup"}</em></div>
        <p className="insight"><span>✦</span>{assessment?.summary ?? "Add activity data, a goal, and athlete feedback to strengthen the coaching assessment."}</p>
      </section></aside>
    </div>
  </>;
}

function PlanTab({ state, coach, draft, busy, act }: { state: WorkspaceState; coach: boolean; draft?: AnyRow; busy: string; act: (action: string, payload?: AnyRow, success?: string) => void }) {
  const [filter, setFilter] = useState("upcoming"); const plans = state.plans;
  const selectedPlan = draft ?? plans.find((plan) => plan.status === "published") ?? plans[0];
  const sessions = state.sessions.filter((session) => !selectedPlan || session.plan_id === selectedPlan.id).filter((session) => filter === "all" || session.session_date >= new Date().toISOString().slice(0,10));
  return <section className="workspace-section"><div className="section-hero"><div><p className="eyebrow">TRAINING PLAN</p><h2>{selectedPlan ? `Version ${selectedPlan.version} · ${selectedPlan.status}` : "No plan yet"}</h2><p>{selectedPlan?.rationale ?? "Create a goal first, then generate a coach-reviewed draft."}</p></div>{coach && <div className="hero-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => act("generatePlan", {}, "A new draft plan was generated")}>{busy === "generatePlan" ? "Generating…" : "+ Generate draft"}</button>{draft && <button className="primary-button" disabled={Boolean(busy)} onClick={() => act("publishPlan", { planId: draft.id }, "Plan published and delivery queued")}>Publish v{draft.version}</button>}</div>}</div>
    <div className="toolbar"><div className="segmented"><button className={filter === "upcoming" ? "active" : ""} onClick={() => setFilter("upcoming")}>Upcoming</button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Full plan</button></div>{plans.some((plan) => plan.status === "published") && <a className="secondary-button link-button" href={`/api/calendar?athleteId=${state.selectedAthlete?.id}`}>Download calendar</a>}</div>
    {state.metrics.dueSessions > 0 && <div className="plan-summary"><span><strong>{state.metrics.adherencePercent}%</strong> adherence</span><span>{state.metrics.completedSessions} of {state.metrics.dueSessions} due sessions completed</span></div>}
    <section className="panel"><SessionList sessions={sessions} expanded coach={coach} editable={selectedPlan?.status === "draft"} canLog={!coach && selectedPlan?.status === "published"} busy={busy} act={act} /></section>
  </section>;
}

function TestingTab({ state, coach, onAdd }: { state: WorkspaceState; coach: boolean; onAdd: () => void }) {
  return <section className="workspace-section"><div className="section-hero"><div><p className="eyebrow">PHYSIOLOGICAL TESTING</p><h2>Lactate history</h2><p>Stage observations remain separate from derived thresholds so interpretations can be revised without losing source data.</p></div>{coach && <button className="primary-button" onClick={onAdd}>+ Record lactate test</button>}</div>
    {!state.tests.length ? <EmptyPanel title="No test recorded" body="Add the complete protocol, thresholds, and stage-by-stage lactate observations." /> : state.tests.map((test) => <article className="panel test-card" key={test.id}><div className="panel-header"><div><p className="eyebrow">{formatDate(test.test_date)} · {test.venue || "Venue not recorded"}</p><h3>{test.protocol}</h3></div><span className="pill positive">{test.confidence} confidence</span></div><div className="threshold-grid"><Threshold label="LT1" pace={test.lt1_pace_seconds_km} hr={test.lt1_hr} lactate={test.lt1_lactate} /><Threshold label="LT2" pace={test.lt2_pace_seconds_km} hr={test.lt2_hr} lactate={test.lt2_lactate} /></div>{test.stages?.length > 0 && <div className="stage-table"><table><thead><tr><th>Stage</th><th>Pace</th><th>HR</th><th>Lactate</th><th>RPE</th></tr></thead><tbody>{test.stages.map((stage: AnyRow) => <tr key={stage.id}><td>{stage.stage_number}</td><td>{formatPace(stage.pace_seconds_km)}</td><td>{stage.heart_rate ?? "—"}</td><td>{stage.lactate_mmol} mmol/L</td><td>{stage.rpe ?? "—"}</td></tr>)}</tbody></table></div>}<p className="card-note">{test.notes || "No interpretation notes."}</p></article>)}
  </section>;
}

function GoalsTab({ state, coach, onAdd }: { state: WorkspaceState; coach: boolean; onAdd: () => void }) {
  return <section className="workspace-section"><div className="section-hero"><div><p className="eyebrow">GOALS & EVENTS</p><h2>Race roadmap</h2><p>Priority determines which event controls the current plan and taper.</p></div>{coach && <button className="primary-button" onClick={onAdd}>+ Add goal</button>}</div><div className="goal-list">{state.goals.length ? state.goals.map((goal) => <article className="panel goal-card" key={goal.id}><div className={`priority priority-${String(goal.priority).toLowerCase()}`}>{goal.priority}</div><div><p className="eyebrow">{formatDate(goal.event_date)} · {goal.distance_km ? `${goal.distance_km} km` : "Event"}</p><h3>{goal.title}</h3><p>{goal.notes || "No additional notes."}</p></div><div className="goal-time"><small>Target</small><strong>{goal.goal_time_seconds ? formatDuration(goal.goal_time_seconds) : "Finish goal"}</strong><span className="pill positive">{goal.status}</span></div></article>) : <EmptyPanel title="No goals yet" body="Add an event date, distance, priority, and optional target time." />}</div></section>;
}

function FeedbackTab({ state, coach, onAdd, act, busy }: { state: WorkspaceState; coach: boolean; onAdd: () => void; act: (a:string,p?:AnyRow,s?:string)=>void; busy:string }) {
  const [note, setNote] = useState("");
  return <section className="workspace-section"><div className="section-hero"><div><p className="eyebrow">ATHLETE FEEDBACK</p><h2>Recovery and conversation</h2><p>Subjective feedback is shown beside load data; it never gets silently converted into a diagnosis.</p></div><button className="primary-button" onClick={onAdd}>+ Daily check-in</button></div><div className="feedback-grid"><div className="panel feedback-list">{state.feedback.length ? state.feedback.map((item) => <article className="feedback-item" key={item.id}><div className="feedback-date"><strong>{new Date(`${item.feedback_date}T12:00:00Z`).getUTCDate()}</strong><span>{new Date(`${item.feedback_date}T12:00:00Z`).toLocaleDateString("en",{month:"short",timeZone:"UTC"})}</span></div><div><strong>{item.pain ? "Pain reported" : "Daily check-in"}</strong><p>{item.comments || item.pain || "No comments."}</p><div className="feedback-chips"><span>Fatigue {item.fatigue ?? "—"}/10</span><span>Legs {item.legs ?? "—"}/10</span><span>Sleep {item.sleep ?? "—"}/10</span></div></div></article>) : <EmptyPanel title="No feedback yet" body="The athlete can submit fatigue, legs, sleep, pain, and comments." />}</div>{coach && <aside className="panel note-panel"><p className="eyebrow">PRIVATE COACH NOTES</p><h3>Notes are coach-only</h3><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Capture context, a follow-up question, or your plan decision…" /><button className="primary-button" disabled={!note.trim() || Boolean(busy)} onClick={() => { act("saveCoachNote", { note }, "Private note saved"); setNote(""); }}>Save note</button><div className="note-history">{state.notes.map((item) => <p key={item.id}>{item.body}<small>{formatDateTime(item.created_at)}</small></p>)}</div></aside>}</div></section>;
}

function DataTab({ state, coach, busy, act }: { state: WorkspaceState; coach: boolean; busy: string; act: (a:string,p?:AnyRow,s?:string)=>void }) {
  const connection = state.connections.find((item) => item.provider === "intervals");
  return <section className="workspace-section"><div className="section-hero"><div><p className="eyebrow">DATA & DELIVERY</p><h2>Private connections</h2><p>Each athlete authorizes their own source. Tokens are encrypted and never shown in the dashboard.</p></div></div><div className="settings-grid"><article className="panel integration-card"><div className="integration-logo">I</div><div><h3>Intervals.icu</h3><p>Read completed activities and wellness. Calendar write access remains off.</p>{connection ? <><span className="pill positive">Connected · {connection.scope}</span><small>Last sync: {connection.last_sync_at ? formatDateTime(connection.last_sync_at) : "not yet"}</small></> : <span className="pill muted-pill">Not connected</span>}</div>{coach && <div className="integration-actions">{connection?.status === "active" ? <><button className="primary-button" disabled={Boolean(busy)} onClick={() => act("runPipeline", {}, "Sync and assessment pipeline completed")}>{busy === "runPipeline" ? "Syncing…" : "Sync now"}</button><button className="text-button danger" onClick={() => act("disconnectIntervals", {}, "Intervals.icu disconnected")}>Disconnect</button></> : <a className="primary-button link-button" href={`/api/intervals/connect?athleteId=${state.selectedAthlete?.id}`}>Connect securely</a>}</div>}</article><article className="panel delivery-card"><p className="eyebrow">DELIVERY OUTBOX</p><h3>Notifications</h3><div className="delivery-list">{state.notifications.length ? state.notifications.map((item) => <div key={item.id}><span className={`delivery-status ${item.status}`} /> <strong>{item.subject}</strong><small>{item.status} · {formatDateTime(item.created_at)}</small></div>) : <p>No delivery events yet.</p>}</div></article></div><section className="panel pipeline-panel"><div className="panel-header"><div><p className="eyebrow">BACKGROUND PIPELINE</p><h3>Recent jobs</h3></div></div><div className="stage-table"><table><thead><tr><th>Job</th><th>Scheduled</th><th>Status</th><th>Attempts</th><th>Detail</th></tr></thead><tbody>{state.jobs.length ? state.jobs.map((job) => <tr key={job.id}><td>{job.job_type.replaceAll("_", " ")}</td><td>{formatDateTime(job.scheduled_at)}</td><td><span className={`job-status ${job.status}`}>{job.status}</span></td><td>{job.attempts}</td><td>{job.last_error || "—"}</td></tr>) : <tr><td colSpan={5}>No background jobs yet.</td></tr>}</tbody></table></div></section></section>;
}

function SessionList({ sessions, expanded = false, coach = false, editable = false, canLog = false, busy = "", act }: { sessions: AnyRow[]; expanded?: boolean; coach?: boolean; editable?: boolean; canLog?: boolean; busy?: string; act?: (action:string,payload?:AnyRow,success?:string)=>void }) { return <div className="session-list">{sessions.length ? sessions.map((session) => <article className={`session ${expanded ? "expanded" : ""}`} key={session.id}><div className="session-date"><b>{weekday(session.session_date)}</b><span>{shortDate(session.session_date)}</span></div><div className={`session-icon ${session.major_stimulus ? "key" : ""}`}>{session.major_stimulus ? "↗" : "·"}</div><div className="session-detail"><div className="session-title-line"><strong>{session.title}</strong>{session.status !== "planned" && <span className={`session-state ${session.status}`}>{session.status}</span>}</div><span>{expanded ? session.details : session.pace_guidance || session.details}</span>{expanded && <small>{session.purpose}</small>}{expanded && editable && coach && act && <details className="session-actions"><summary>Edit draft session</summary><SessionEditForm session={session} busy={busy} submit={(values) => act("updatePlanSession", { sessionId: session.id, ...values }, "Draft session updated")} /></details>}{expanded && canLog && act && session.workout_type !== "rest" && <details className="session-actions"><summary>{session.status === "planned" ? "Log this session" : "Update session log"}</summary><SessionLogForm session={session} busy={busy} submit={(values) => act("logSession", { sessionId: session.id, ...values }, "Session log saved")} /></details>}</div><b className="session-distance">{Number(session.planned_distance_km) ? `${session.planned_distance_km} km` : "Rest"}</b></article>) : <div className="empty-inline">No sessions available.</div>}</div>; }

function SessionEditForm({ session, busy, submit }: { session:AnyRow; busy:string; submit:(values:AnyRow)=>void }) { function onSubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();submit(Object.fromEntries(new FormData(event.currentTarget).entries()));} return <form className="session-editor" onSubmit={onSubmit}><div className="form-row"><Field name="sessionDate" label="Date" type="date" defaultValue={session.session_date} required /><Field name="plannedDistanceKm" label="Distance (km)" type="number" step="0.1" defaultValue={session.planned_distance_km ?? ""} /></div><Field name="title" label="Session title" defaultValue={session.title} required /><label className="field"><span>Workout details</span><textarea name="details" rows={3} defaultValue={session.details} required /></label><div className="form-row"><Field name="paceGuidance" label="Pace guidance" defaultValue={session.pace_guidance ?? ""} /><Field name="hrGuidance" label="HR guidance" defaultValue={session.hr_guidance ?? ""} /></div><Field name="purpose" label="Purpose" defaultValue={session.purpose ?? ""} /><label className="check-field"><input name="majorStimulus" type="checkbox" defaultChecked={Boolean(session.major_stimulus)} /> Key stimulus</label><button className="secondary-button" disabled={Boolean(busy)}>Save changes</button></form>; }
function SessionLogForm({ session, busy, submit }: { session:AnyRow; busy:string; submit:(values:AnyRow)=>void }) { function onSubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();submit(Object.fromEntries(new FormData(event.currentTarget).entries()));} return <form className="session-editor" onSubmit={onSubmit}><div className="form-row"><label className="field"><span>Outcome</span><select name="status" defaultValue={session.status === "skipped" ? "skipped" : "completed"}><option value="completed">Completed</option><option value="skipped">Skipped</option></select></label><Field name="completionRpe" label="RPE (1–10)" type="number" min="1" max="10" defaultValue={session.completion_rpe ?? ""} /></div><div className="form-row"><Field name="actualDistanceKm" label="Actual distance (km)" type="number" step="0.1" defaultValue={session.actual_distance_km ?? ""} /><Field name="actualDurationMinutes" label="Duration (minutes)" type="number" defaultValue={session.actual_duration_minutes ?? ""} /></div><label className="field"><span>Comment for your coach</span><textarea name="athleteComment" rows={2} defaultValue={session.athlete_comment ?? ""} /></label><button className="primary-button" disabled={Boolean(busy)}>Save session log</button></form>; }
function Threshold({ label, pace, hr, lactate }: { label:string; pace:any; hr:any; lactate:any }) { return <div><span>{label}</span><strong>{formatPace(pace)}</strong><p>{hr ? `${hr} bpm` : "HR —"} · {lactate ? `${lactate} mmol/L` : "lactate —"}</p></div>; }
function NavButton({ active, label, icon, badge, onClick }: { active:boolean; label:string; icon:string; badge?:string; onClick:()=>void }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span>{label}{badge && <b>{badge}</b>}</button>; }
function EmptyPanel({ title, body }: { title:string; body:string }) { return <div className="panel empty-panel"><span>○</span><h3>{title}</h3><p>{body}</p></div>; }
function LoadingScreen({ message }: { message?:string }) { return <div className="loading-screen"><span className="brand-mark">A</span><h1>Preparing your coaching workspace</h1><p>{message || "Loading private athlete records…"}</p></div>; }
function EmptyWorkspace({ user, onInvite, modal, close, act, busy }: any) { return <div className="loading-screen"><span className="brand-mark">A</span><h1>Welcome, {user.displayName}</h1><p>Invite your first athlete to begin.</p><button className="primary-button" onClick={onInvite}>Invite athlete</button>{modal && <ModalLayer modal="invite" athlete={null} close={close} act={act} busy={busy} />}</div>; }

function ModalLayer({ modal, athlete, close, act, busy }: { modal: Exclude<Modal,null>; athlete: AnyRow | null; close:()=>void; act:(a:string,p?:AnyRow,s?:string)=>void; busy:string }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={close} aria-label="Close">×</button>
    {modal === "invite" && <InviteForm submit={(data) => act("inviteAthlete", data, "Athlete invited and delivery queued")} busy={busy} />}
    {modal === "goal" && <GoalForm submit={(data) => act("saveGoal", data, "Goal saved")} busy={busy} />}
    {modal === "test" && <TestForm submit={(data) => act("saveLactateTest", data, "Lactate test recorded")} busy={busy} />}
    {modal === "feedback" && <FeedbackForm submit={(data) => act("submitFeedback", data, "Check-in saved")} busy={busy} />}
    {modal === "profile" && athlete && <ProfileForm athlete={athlete} submit={(data) => act("updateAthlete", data, "Athlete profile updated")} busy={busy} />}
  </div></div>;
}

function InviteForm({ submit, busy }: FormProps) { return <BasicForm title="Invite athlete" intro="Create their private profile and queue a secure invitation." submit={submit} busy={busy} action="Invite athlete"><Field name="displayName" label="Full name" required /><Field name="email" label="Email" type="email" required /><Field name="weeklyTargetKm" label="Current weekly volume (km)" type="number" /><Field name="timezone" label="Timezone" defaultValue="Europe/Vienna" /></BasicForm>; }
function GoalForm({ submit, busy }: FormProps) { return <BasicForm title="Add goal" intro="The highest-priority active goal controls plan generation." submit={(values) => submit({ ...values, goalTimeSeconds: timeToSeconds(String(values.goalTime ?? "")) })} busy={busy} action="Save goal"><Field name="title" label="Race or goal" required /><Field name="eventDate" label="Event date" type="date" required /><div className="form-row"><Field name="distanceKm" label="Distance (km)" type="number" step="0.01" /><Field name="goalTime" label="Goal time (HH:MM:SS)" placeholder="01:15:00" /></div><label className="field"><span>Priority</span><select name="priority" defaultValue="A"><option>A</option><option>B</option><option>C</option></select></label><label className="field"><span>Context and objective</span><textarea name="notes" rows={3} /></label></BasicForm>; }
function FeedbackForm({ submit, busy }: FormProps) { return <BasicForm title="Daily check-in" intro="Use your own perception; numbers are optional." submit={submit} busy={busy} action="Save check-in"><Field name="feedbackDate" label="Date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /><div className="form-row"><Field name="fatigue" label="Fatigue (1–10)" type="number" min="1" max="10" /><Field name="legs" label="Legs (1–10)" type="number" min="1" max="10" /></div><div className="form-row"><Field name="sleep" label="Sleep (1–10)" type="number" min="1" max="10" /><Field name="rpe" label="Session RPE" type="number" min="1" max="10" /></div><Field name="pain" label="Pain or symptoms" placeholder="Location, onset, and how it changes movement" /><label className="field"><span>Comments</span><textarea name="comments" rows={3} /></label></BasicForm>; }
function ProfileForm({ athlete, submit, busy }: FormProps & { athlete:AnyRow }) { return <BasicForm title="Athlete profile" intro="Availability and health context directly affect future drafts." submit={submit} busy={busy} action="Update profile"><Field name="displayName" label="Full name" defaultValue={athlete.displayName} required /><Field name="weeklyTargetKm" label="Sustainable weekly volume (km)" type="number" defaultValue={athlete.weeklyTargetKm ?? ""} /><label className="field"><span>Injury / restriction context</span><textarea name="injuryNotes" rows={4} defaultValue={athlete.injuryNotes ?? ""} /></label></BasicForm>; }
function TestForm({ submit, busy }: FormProps) {
  const [stages, setStages] = useState("3:00,4:30,140,1.2,2\n3:00,4:10,152,1.6,3\n3:00,3:50,164,2.4,5\n3:00,3:35,174,4.1,7");
  return <BasicForm title="Record lactate test" intro="Keep original stage data and derived thresholds together, with the interpretation method explicit." submit={(values) => submit({ ...values, lt1PaceSecondsKm: paceToSeconds(String(values.lt1Pace ?? "")), lt2PaceSecondsKm: paceToSeconds(String(values.lt2Pace ?? "")), stages: parseStages(stages) })} busy={busy} action="Save test" wide><div className="form-row"><Field name="testDate" label="Test date" type="date" required /><Field name="venue" label="Venue / lab" /></div><Field name="protocol" label="Protocol" placeholder="5 × 3 min treadmill stages, 1% incline" required /><div className="threshold-form"><h4>Derived LT1</h4><Field name="lt1Pace" label="Pace (MM:SS/km)" /><Field name="lt1Hr" label="HR" type="number" /><Field name="lt1Lactate" label="Lactate" type="number" step="0.1" /><h4>Derived LT2</h4><Field name="lt2Pace" label="Pace (MM:SS/km)" /><Field name="lt2Hr" label="HR" type="number" /><Field name="lt2Lactate" label="Lactate" type="number" step="0.1" /></div><Field name="interpretationMethod" label="Interpretation method" placeholder="Visual breakpoint + Dmax review" /><label className="field"><span>Stage data — duration, pace, HR, lactate, RPE</span><textarea value={stages} onChange={(event) => setStages(event.target.value)} rows={5} /><small>One stage per line. Example: 3:00,4:10,152,1.6,3</small></label><label className="field"><span>Confidence</span><select name="confidence" defaultValue="moderate"><option>low</option><option>moderate</option><option>high</option></select></label><label className="field"><span>Interpretation notes</span><textarea name="notes" rows={3} /></label></BasicForm>;
}

type FormProps = { submit:(values:AnyRow)=>void; busy:string };
function BasicForm({ title, intro, submit, busy, action, children, wide=false }: FormProps & { title:string; intro:string; action:string; children:React.ReactNode; wide?:boolean }) {
  function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); submit(Object.fromEntries(form.entries())); }
  return <form className={`modal-form ${wide ? "wide" : ""}`} onSubmit={onSubmit}><p className="eyebrow">PRIVATE WORKSPACE</p><h2 id="modal-title">{title}</h2><p className="form-intro">{intro}</p>{children}<button className="primary-button form-submit" disabled={Boolean(busy)}>{busy ? "Working…" : action}</button></form>;
}
function Field(props: AnyRow) { const { label, ...inputProps } = props; return <label className="field"><span>{label}</span><input {...inputProps} /></label>; }

function initials(name:string) { return name.split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase(); }
function dayPart() { const hour = new Date().getHours(); return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"; }
function athleteStatus(athlete:AnyRow,state:WorkspaceState) { if (athlete.status === "invited") return "Invitation pending"; if (athlete.id === state.selectedAthlete?.id) return state.metrics.recoveryStatus; return "Active"; }
function connectionStatus(connections:AnyRow[]) { const connection = connections.find((item) => item.status === "active"); return <span className="sync-state"><i />{connection ? `Synced ${connection.last_sync_at ? formatRelative(connection.last_sync_at) : "pending"}` : "Manual data"}</span>; }
function formatDuration(value:any) { const total = Number(value); if (!Number.isFinite(total)) return "—"; const hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),seconds=Math.round(total%60); return hours ? `${hours}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}` : `${minutes}:${String(seconds).padStart(2,"0")}`; }
function formatPace(value:any) { const total=Number(value); return Number.isFinite(total)&&total>0 ? `${Math.floor(total/60)}:${String(Math.round(total%60)).padStart(2,"0")}/km` : "—"; }
function formatDate(value:any) { if(!value)return "—"; return new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString("en",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}); }
function formatDateTime(value:any) { if(!value)return "—"; return new Date(value).toLocaleString("en",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}); }
function formatRelative(value:string) { const minutes=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/60000)); return minutes<2?"just now":minutes<60?`${minutes} min ago`:`${Math.round(minutes/60)} h ago`; }
function weekday(value:string) { return new Date(`${value}T12:00:00Z`).toLocaleDateString("en",{weekday:"short",timeZone:"UTC"}).toUpperCase(); }
function shortDate(value:string) { return new Date(`${value}T12:00:00Z`).toLocaleDateString("en",{day:"numeric",month:"short",timeZone:"UTC"}); }
function timeToSeconds(value:string) { if(!value)return null; const parts=value.split(":").map(Number); if(parts.some((part)=>!Number.isFinite(part)))return null; return parts.length===3?parts[0]*3600+parts[1]*60+parts[2]:parts[0]*60+parts[1]; }
function paceToSeconds(value:string) { const parts=value.split(":").map(Number); return parts.length===2&&parts.every(Number.isFinite)?parts[0]*60+parts[1]:null; }
function parseStages(value:string) { return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [duration,pace,heartRate,lactateMmol,rpe]=line.split(",").map((part)=>part.trim()); return { durationSeconds:timeToSeconds(duration),paceSecondsKm:paceToSeconds(pace),heartRate:Number(heartRate)||null,lactateMmol:Number(lactateMmol),rpe:Number(rpe)||null }; }).filter((stage)=>Number.isFinite(stage.lactateMmol)); }
