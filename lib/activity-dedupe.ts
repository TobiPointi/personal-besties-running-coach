type ActivityRow = Record<string, unknown>;

/**
 * Tobias's protected local reference history remains in D1 for auditability.
 * Once the same activity arrives from Intervals.icu, prefer the live record so
 * volume, forecasts, and reports do not count the reference copy twice.
 */
export function dedupeActivities<T extends ActivityRow>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const row of rows) {
    const duplicateIndex = kept.findIndex((candidate) => isReferencePair(candidate, row) && sameActivity(candidate, row));
    if (duplicateIndex < 0) kept.push(row);
    else if (providerPriority(row.provider) > providerPriority(kept[duplicateIndex].provider)) kept[duplicateIndex] = row;
  }
  return kept;
}

function isReferencePair(first: ActivityRow, second: ActivityRow) {
  return String(first.provider).toLowerCase() === "reference" || String(second.provider).toLowerCase() === "reference";
}

function sameActivity(first: ActivityRow, second: ActivityRow) {
  if (String(first.activity_date) !== String(second.activity_date)) return false;
  if (sport(first.activity_type) !== sport(second.activity_type)) return false;
  const firstProviderId = String(first.provider_activity_id ?? ""); const secondProviderId = String(second.provider_activity_id ?? "");
  if (firstProviderId && firstProviderId === secondProviderId) return true;
  const sameName = normalizedName(first.name) === normalizedName(second.name);
  const distanceClose = Math.abs(Number(first.distance_km ?? 0) - Number(second.distance_km ?? 0)) <= 0.3;
  const durationClose = Math.abs(Number(first.duration_seconds ?? 0) - Number(second.duration_seconds ?? 0)) <= 240;
  return sameName && distanceClose && durationClose;
}

function normalizedName(value: unknown) { return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim(); }
function sport(value: unknown) { const text=String(value ?? "").toLowerCase(); return text.includes("run") ? "run" : text.includes("ride") || text.includes("cycle") || text.includes("bike") ? "cycle" : text; }
function providerPriority(value: unknown) { const provider=String(value ?? "").toLowerCase(); return provider === "intervals" ? 3 : provider === "reference" ? 0 : 2; }
