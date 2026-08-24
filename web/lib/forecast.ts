export type ForecastActivity = {
  activity_date: unknown;
  activity_type: unknown;
  name?: unknown;
  distance_km: unknown;
  duration_seconds: unknown;
  elevation_gain_m?: unknown;
};

export type RaceForecast = {
  predictions: Record<"5k" | "10k" | "half" | "marathon", number>;
  lowSeconds: number;
  highSeconds: number;
  confidence: "low" | "moderate" | "high";
  evidence: { eligibleRuns: number; raceLikeRuns: number; weeklyKm: number; longestRunKm: number };
};

const DISTANCES = { "5k": 5, "10k": 10, half: 21.0975, marathon: 42.195 } as const;

export function forecastFromActivities(activities: ForecastActivity[], asOf: string, goalDistanceKm: number | null): RaceForecast | null {
  const end = new Date(`${asOf}T12:00:00Z`).getTime();
  if (!Number.isFinite(end)) return null;
  const inLast = (days: number) => end - days * 86_400_000;
  const runs = activities.map(normalizeActivity).filter((run): run is NormalizedRun => Boolean(run) && run.date.getTime() <= end);
  const recent = runs.filter((run) => run.date.getTime() >= inLast(56));
  const candidates = recent.filter((run) => run.distanceKm >= 3 && run.distanceKm <= 42.5 && run.durationSeconds >= 900 && run.elevationPerKm <= 25);
  if (!candidates.length) return null;

  const raceLike = candidates.filter((run) => /race|wettkampf|parkrun|time.?trial|test|5\s?k|10\s?k|half|marathon/i.test(run.name));
  const anchors = (raceLike.length ? raceLike : candidates)
    .sort((a, b) => a.paceSecondsKm - b.paceSecondsKm)
    .slice(0, Math.min(5, raceLike.length || 3));
  const weeklyKm = sum(recent.filter((run) => run.date.getTime() >= inLast(28)).map((run) => run.distanceKm)) / 4;
  const longestRunKm = Math.max(0, ...recent.map((run) => run.distanceKm));
  const predictions = {} as RaceForecast["predictions"];

  for (const [key, targetKm] of Object.entries(DISTANCES) as [keyof typeof DISTANCES, number][]) {
    const estimates = anchors.map((anchor) => project(anchor, targetKm, weeklyKm, longestRunKm));
    predictions[key] = Math.round(weightedMedian(estimates));
  }

  const target = closestDistance(goalDistanceKm);
  const centre = predictions[target];
  const uncertainty = target === "marathon" ? 0.065 : target === "half" ? 0.045 : 0.035;
  // Training runs alone can indicate a useful trend, but they do not calibrate a
  // race prediction. Do not imply moderate confidence merely because volume is high.
  const confidence: RaceForecast["confidence"] = raceLike.length >= 2 && weeklyKm >= 45 ? "high" : raceLike.length >= 1 && weeklyKm >= 25 ? "moderate" : "low";
  return {
    predictions,
    lowSeconds: Math.round(centre * (1 - uncertainty)),
    highSeconds: Math.round(centre * (1 + uncertainty)),
    confidence,
    evidence: { eligibleRuns: candidates.length, raceLikeRuns: raceLike.length, weeklyKm: round(weeklyKm), longestRunKm: round(longestRunKm) },
  };
}

type NormalizedRun = { date: Date; name: string; distanceKm: number; durationSeconds: number; paceSecondsKm: number; elevationPerKm: number };
function normalizeActivity(value: ForecastActivity): NormalizedRun | null {
  if (!/run/i.test(String(value.activity_type ?? ""))) return null;
  const date = new Date(`${String(value.activity_date).slice(0, 10)}T12:00:00Z`);
  const distanceKm = Number(value.distance_km), durationSeconds = Number(value.duration_seconds), elevation = Number(value.elevation_gain_m ?? 0);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(distanceKm) || !Number.isFinite(durationSeconds) || distanceKm <= 0 || durationSeconds <= 0) return null;
  return { date, name: String(value.name ?? ""), distanceKm, durationSeconds, paceSecondsKm: durationSeconds / distanceKm, elevationPerKm: Number.isFinite(elevation) ? elevation / distanceKm : 0 };
}

function project(anchor: NormalizedRun, targetKm: number, weeklyKm: number, longestRunKm: number) {
  // A Riegel-style power curve is the starting point. Endurance penalties deliberately widen/slow longer forecasts when volume or long-run evidence is missing.
  const ratio = targetKm / anchor.distanceKm;
  const exponent = targetKm >= 42 ? 1.075 : targetKm >= 21 ? 1.065 : 1.06;
  let projected = anchor.durationSeconds * Math.pow(ratio, exponent);
  if (targetKm >= 21) projected *= 1 + Math.max(0, 55 - weeklyKm) / 1600;
  if (targetKm >= 42) projected *= 1 + Math.max(0, 28 - longestRunKm) / 450;
  return projected;
}

function weightedMedian(values: number[]) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN; }
function closestDistance(km: number | null) { if (!km) return "half" as const; return (Object.entries(DISTANCES).sort(([, a], [, b]) => Math.abs(a - km) - Math.abs(b - km))[0]?.[0] ?? "half") as keyof typeof DISTANCES; }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function round(value: number) { return Math.round(value * 10) / 10; }
