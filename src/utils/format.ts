const LOCALE = typeof navigator !== "undefined" ? navigator.language : "de-AT";

export function speedToPaceSec(speedKmh: number): number {
  return 3600 / speedKmh;
}

export function paceSecToSpeed(paceSecPerKm: number): number {
  return 3600 / paceSecPerKm;
}

export function formatPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatPaceSpeed(speedKmh: number): string {
  return `${formatPace(speedToPaceSec(speedKmh))} /km`;
}

export function formatSpeed(speedKmh: number): string {
  return `${speedKmh.toFixed(1)} km/h`;
}

export function formatHeartRate(bpm: number | null | undefined): string {
  return bpm == null ? "–" : `${Math.round(bpm)} bpm`;
}

export function formatLactate(mmol: number): string {
  return `${mmol.toFixed(2)} mmol/L`;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}
