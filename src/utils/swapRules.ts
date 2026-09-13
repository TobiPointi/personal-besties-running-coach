import { isKeySession, type SessionType, type TrainingSession } from "../types/training";

export type MoveDecision =
  | { outcome: "allowed" }
  | { outcome: "blocked"; reason: string }
  | { outcome: "needs_approval"; reason: string };

function toLocalMidnight(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function dayDiff(isoA: string, isoB: string): number {
  const ms = toLocalMidnight(isoA).getTime() - toLocalMidnight(isoB).getTime();
  return Math.round(ms / 86400000);
}

/**
 * Guardrails for moving a training session.
 * - past            -> hard block
 * - key session (interval/long) moved to today/tomorrow        -> coach approval
 * - key session would land <24h next to another key session    -> coach approval
 * - session already moved twice                                -> coach approval
 * Everything else is auto-approved.
 */
export function evaluateMove(
  session: TrainingSession,
  toDate: string,
  allSessions: TrainingSession[],
  now: Date = new Date(),
): MoveDecision {
  const today = isoDate(now);
  const tomorrow = isoDate(new Date(now.getTime() + 86400000));

  if (toDate < today) {
    return { outcome: "blocked", reason: "Sessions cannot be moved into the past." };
  }
  if (toDate === session.date) {
    return { outcome: "blocked", reason: "Session is already on that date." };
  }

  if (isKeySession(session.type)) {
    if (toDate === today || toDate === tomorrow) {
      return {
        outcome: "needs_approval",
        reason:
          "Intervals and long runs cannot be moved to today or tomorrow on your own. A request was sent to your coach.",
      };
    }
    const conflict = allSessions.find(
      (s) =>
        s.id !== session.id &&
        s.status === "planned" &&
        isKeySession(s.type) &&
        Math.abs(dayDiff(toDate, s.date)) <= 1,
    );
    if (conflict) {
      return {
        outcome: "needs_approval",
        reason: `Less than 24h gap to another key session (${conflict.title}). A request was sent to your coach.`,
      };
    }
  }

  if (session.moveCount >= 2) {
    return {
      outcome: "needs_approval",
      reason: "This session was already moved twice. A request was sent to your coach.",
    };
  }

  return { outcome: "allowed" };
}

export function formatDayLabel(iso: string, locale = navigator.language): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(
    toLocalMidnight(iso),
  );
}

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  easy: "Easy run",
  interval: "Intervals",
  tempo: "Tempo",
  long: "Long run",
  strength: "Strength",
  rest: "Rest day",
};
