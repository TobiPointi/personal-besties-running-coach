import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeRequest, TrainingSession } from "../../types/training";
import { store } from "../../lib/trainingStore";
import { isDemoMode } from "../../lib/supabase";
import {
  evaluateMove,
  formatDayLabel,
  SESSION_TYPE_LABELS,
} from "../../utils/swapRules";
import "./training.css";

const TYPE_COLORS: Record<string, string> = {
  easy: "#7A8CA3",
  interval: "#E8590C",
  tempo: "#E8930C",
  long: "#1971C2",
  strength: "#7048A8",
  rest: "#ADB5BD",
};

interface MoveState {
  sessionId: string;
  toDate: string;
}

interface Feedback {
  kind: "ok" | "error" | "approval";
  text: string;
}

export function TrainingPlan({ athleteId }: { athleteId: string }) {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [move, setMove] = useState<MoveState | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [s, r] = await Promise.all([store.listSessions(), store.listRequests()]);
    setSessions(s);
    setRequests(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, TrainingSession[]>();
    for (const s of sessions.filter((s) => s.athleteId === athleteId)) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions, athleteId]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const markDone = async (session: TrainingSession) => {
    await store.updateSession({ ...session, status: "completed" });
    setFeedback({ kind: "ok", text: `"${session.title}" marked as done.` });
    reload();
  };

  const confirmMove = async (session: TrainingSession, toDate: string) => {
    const decision = evaluateMove(session, toDate, sessions);
    if (decision.outcome === "blocked") {
      setFeedback({ kind: "error", text: decision.reason });
      return;
    }
    if (decision.outcome === "needs_approval") {
      await store.createRequest({
        sessionId: session.id,
        athleteId: session.athleteId,
        athleteName: session.athleteName,
        sessionTitle: session.title,
        sessionType: session.type,
        fromDate: session.date,
        toDate,
        reason: decision.reason,
      });
      setFeedback({ kind: "approval", text: decision.reason });
      setMove(null);
      reload();
      return;
    }
    await store.updateSession({
      ...session,
      date: toDate,
      status: "moved",
      moveCount: session.moveCount + 1,
    });
    setFeedback({
      kind: "ok",
      text: `"${session.title}" moved to ${formatDayLabel(toDate)}.`,
    });
    setMove(null);
    reload();
  };

  return (
    <section className="trn-root">
      <header className="trn-header">
        <div>
          <h2 className="trn-title">Training plan</h2>
          <div className="trn-sub">
            {isDemoMode
              ? "Demo data — connect Supabase (.env) for the live plan"
              : "Live plan"}
          </div>
        </div>
        {pendingCount > 0 && (
          <span className="trn-pending-pill">
            {pendingCount} change request{pendingCount > 1 ? "s" : ""} pending
          </span>
        )}
      </header>

      {feedback && <div className={`trn-feedback is-${feedback.kind}`}>{feedback.text}</div>}

      {loading ? (
        <div className="trn-empty">Loading…</div>
      ) : (
        grouped.map(([date, daySessions]) => (
          <div key={date} className={`trn-day${date === todayIso ? " is-today" : ""}`}>
            <div className="trn-day-label">
              {formatDayLabel(date)}
              {date === todayIso && <span className="trn-today-tag">today</span>}
            </div>
            {daySessions.map((s) => {
              const isMoving = move?.sessionId === s.id;
              const done = s.status === "completed";
              return (
                <div key={s.id} className={`trn-session is-${s.status}`}>
                  <span className="trn-type-dot" style={{ background: TYPE_COLORS[s.type] }} />
                  <div className="trn-session-main">
                    <div className="trn-session-title">
                      {s.title}
                      {s.status === "missed" && <span className="trn-badge is-missed">missed</span>}
                      {s.status === "completed" && <span className="trn-badge is-done">done</span>}
                      {s.status === "moved" && <span className="trn-badge is-moved">moved</span>}
                    </div>
                    <div className="trn-session-meta">
                      {SESSION_TYPE_LABELS[s.type]}
                      {s.durationMin ? ` · ${s.durationMin} min` : ""}
                      {s.moveCount > 0 && ` · moved ${s.moveCount}x`}
                    </div>
                    {isMoving && (
                      <div className="trn-move-box">
                        <input
                          type="date"
                          value={move.toDate}
                          min={todayIso}
                          onChange={(e) => setMove({ sessionId: s.id, toDate: e.target.value })}
                          aria-label="New date"
                        />
                        <button
                          type="button"
                          className="trn-btn is-primary"
                          disabled={!move.toDate}
                          onClick={() => confirmMove(s, move.toDate)}
                        >
                          Move
                        </button>
                        <button type="button" className="trn-btn" onClick={() => setMove(null)}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="trn-session-actions">
                    {!done && s.status === "planned" && date >= todayIso && (
                      <button type="button" className="trn-btn" onClick={() => markDone(s)}>
                        Done
                      </button>
                    )}
                    {date >= todayIso && s.status !== "completed" && !isMoving && (
                      <button
                        type="button"
                        className="trn-btn"
                        onClick={() => setMove({ sessionId: s.id, toDate: s.date })}
                      >
                        Move
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}

export function ChangeRequestsInbox({ onRequestDecided }: { onRequestDecided?: () => void }) {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setRequests(await store.listRequests());
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const decide = async (id: string, approve: boolean) => {
    await store.decideRequest(id, approve);
    await reload();
    onRequestDecided?.();
  };

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <section className="trn-root">
      <header className="trn-header">
        <div>
          <h2 className="trn-title">Change requests</h2>
          <div className="trn-sub">Coach approval for guarded session moves</div>
        </div>
      </header>

      {loading && <div className="trn-empty">Loading…</div>}
      {!loading && pending.length === 0 && (
        <div className="trn-empty">No open requests. All clear.</div>
      )}

      {pending.map((r) => (
        <div key={r.id} className="trn-request">
          <div className="trn-request-main">
            <div className="trn-session-title">
              {r.athleteName}: {r.sessionTitle}
            </div>
            <div className="trn-session-meta">
              {formatDayLabel(r.fromDate)} → {formatDayLabel(r.toDate)} ·{" "}
              {SESSION_TYPE_LABELS[r.sessionType]}
            </div>
            {r.reason && <div className="trn-request-reason">{r.reason}</div>}
          </div>
          <div className="trn-session-actions">
            <button type="button" className="trn-btn is-approve" onClick={() => decide(r.id, true)}>
              Approve
            </button>
            <button type="button" className="trn-btn is-reject" onClick={() => decide(r.id, false)}>
              Reject
            </button>
          </div>
        </div>
      ))}

      {decided.length > 0 && (
        <>
          <h3 className="trn-decided-title">Decided</h3>
          {decided.map((r) => (
            <div key={r.id} className="trn-request is-decided">
              <div className="trn-request-main">
                <div className="trn-session-title">
                  {r.athleteName}: {r.sessionTitle}
                </div>
                <div className="trn-session-meta">
                  {formatDayLabel(r.fromDate)} → {formatDayLabel(r.toDate)}
                </div>
              </div>
              <span className={`trn-badge ${r.status === "approved" ? "is-done" : "is-missed"}`}>
                {r.status}
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
