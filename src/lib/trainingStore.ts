import type { ChangeRequest, TrainingSession } from "../types/training";
import { supabase } from "./supabase";

export interface TrainingStore {
  listSessions(): Promise<TrainingSession[]>;
  updateSession(session: TrainingSession): Promise<void>;
  listRequests(): Promise<ChangeRequest[]>;
  createRequest(request: Omit<ChangeRequest, "id" | "createdAt" | "status">): Promise<void>;
  decideRequest(id: string, approve: boolean): Promise<void>;
}

/* ------------------------------ Supabase --------------------------------- */

const SESSION_TABLE = "training_sessions";
const REQUEST_TABLE = "change_requests";

interface SessionRow {
  id: string;
  athlete_id: string;
  athlete_name: string;
  date: string;
  type: TrainingSession["type"];
  title: string;
  duration_min: number | null;
  status: TrainingSession["status"];
  move_count: number;
}

interface RequestRow {
  id: string;
  session_id: string;
  athlete_id: string;
  athlete_name: string;
  session_title: string;
  session_type: TrainingSession["type"];
  from_date: string;
  to_date: string;
  reason: string | null;
  status: ChangeRequest["status"];
  created_at: string;
}

function rowToSession(r: SessionRow): TrainingSession {
  return {
    id: r.id,
    athleteId: r.athlete_id,
    athleteName: r.athlete_name,
    date: r.date,
    type: r.type,
    title: r.title,
    durationMin: r.duration_min ?? undefined,
    status: r.status,
    moveCount: r.move_count,
  };
}

const supabaseStore: TrainingStore = {
  async listSessions() {
    const { data, error } = await supabase!.from(SESSION_TABLE).select("*").order("date");
    if (error) throw error;
    return (data as SessionRow[]).map(rowToSession);
  },

  async updateSession(session) {
    const { error } = await supabase!
      .from(SESSION_TABLE)
      .update({
        date: session.date,
        status: session.status,
        move_count: session.moveCount,
      })
      .eq("id", session.id);
    if (error) throw error;
  },

  async listRequests() {
    const { data, error } = await supabase!
      .from(REQUEST_TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as RequestRow[]).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      athleteId: r.athlete_id,
      athleteName: r.athlete_name,
      sessionTitle: r.session_title,
      sessionType: r.session_type,
      fromDate: r.from_date,
      toDate: r.to_date,
      reason: r.reason ?? undefined,
      status: r.status,
      createdAt: r.created_at,
    }));
  },

  async createRequest(request) {
    const { error } = await supabase!.from(REQUEST_TABLE).insert({
      session_id: request.sessionId,
      athlete_id: request.athleteId,
      athlete_name: request.athleteName,
      session_title: request.sessionTitle,
      session_type: request.sessionType,
      from_date: request.fromDate,
      to_date: request.toDate,
      reason: request.reason ?? null,
      status: "pending",
    });
    if (error) throw error;
    // fire-and-forget coach notification
    supabase!.functions
      .invoke("notify-change-request", { body: request })
      .catch(() => undefined);
  },

  async decideRequest(id, approve) {
    const { data, error } = await supabase!
      .from(REQUEST_TABLE)
      .update({ status: approve ? "approved" : "rejected" })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    if (approve) {
      const row = data as RequestRow;
      const { data: session } = await supabase!
        .from(SESSION_TABLE)
        .select("*")
        .eq("id", row.session_id)
        .single();
      if (session) {
        const s = session as SessionRow;
        await supabase!
          .from(SESSION_TABLE)
          .update({ date: row.to_date, status: "moved", move_count: s.move_count + 1 })
          .eq("id", s.id);
      }
    }
  },
};

/* -------------------------------- Demo ----------------------------------- */

function seedSessions(): TrainingSession[] {
  const base = new Date();
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const day = (offset: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  };
  const mk = (
    id: string,
    offset: number,
    type: TrainingSession["type"],
    title: string,
    durationMin: number,
    status: TrainingSession["status"] = "planned",
  ): TrainingSession => ({
    id,
    athleteId: "tobias",
    athleteName: "Tobias Pointner",
    date: day(offset),
    type,
    title,
    durationMin,
    status,
    moveCount: 0,
  });
  return [
    mk("s1", 0, "rest", "Rest day", 0, "completed"),
    mk("s2", 1, "easy", "Easy run 8 km", 52, "completed"),
    mk("s3", 2, "interval", "Intervals 10x400 m", 68),
    mk("s4", 2, "easy", "Recovery jog 4 km", 30),
    mk("s5", 3, "strength", "Strength & mobility", 45, "missed"),
    mk("s6", 4, "easy", "Easy run 10 km", 62),
    mk("s7", 5, "long", "Long run 26 km", 145),
    mk("s8", 6, "easy", "Easy run 6 km", 40),
  ];
}

const demoSessions: TrainingSession[] = seedSessions();
const demoRequests: ChangeRequest[] = [];
let demoReqCounter = 1;

const demoStore: TrainingStore = {
  async listSessions() {
    return [...demoSessions].sort((a, b) => a.date.localeCompare(b.date));
  },

  async updateSession(session) {
    const idx = demoSessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) demoSessions[idx] = { ...session };
  },

  async listRequests() {
    return [...demoRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createRequest(request) {
    demoRequests.push({
      ...request,
      id: `cr-${demoReqCounter++}`,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  },

  async decideRequest(id, approve) {
    const req = demoRequests.find((r) => r.id === id);
    if (!req) return;
    req.status = approve ? "approved" : "rejected";
    if (approve) {
      const session = demoSessions.find((s) => s.id === req.sessionId);
      if (session) {
        session.date = req.toDate;
        session.status = "moved";
        session.moveCount += 1;
      }
    }
  },
};

export const store: TrainingStore = supabase ? supabaseStore : demoStore;
