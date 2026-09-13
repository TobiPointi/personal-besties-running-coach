export type SessionType = "easy" | "interval" | "tempo" | "long" | "strength" | "rest";

export type SessionStatus = "planned" | "completed" | "missed" | "moved";

export interface TrainingSession {
  id: string;
  athleteId: string;
  athleteName: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  type: SessionType;
  title: string;
  durationMin?: number;
  status: SessionStatus;
  moveCount: number;
}

export interface ChangeRequest {
  id: string;
  sessionId: string;
  athleteId: string;
  athleteName: string;
  sessionTitle: string;
  sessionType: SessionType;
  fromDate: string;
  toDate: string;
  reason?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export const KEY_SESSION_TYPES: SessionType[] = ["interval", "long"];

export function isKeySession(type: SessionType): boolean {
  return KEY_SESSION_TYPES.includes(type);
}
