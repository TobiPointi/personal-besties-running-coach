import sourcePlan from "../../plan/bad_ischl_plan.json";

type SourceDay = {
  date: string; status: string; planned_distance_km: number; workout_type: string;
  details: string; pace_guidance?: string; hr_guidance?: string; purpose?: string;
  fatigue_modification?: string; major_stimulus?: boolean;
  actual?: { distance_km?: number; activities?: { id?: string; name?: string; training_load?: number }[] };
};

export const referencePlanDays = (sourcePlan.days as SourceDay[]).filter((day) => /^2026-08-(1[4-9]|2\d|3[01])$|^2026-09-(0\d|1\d|2[0-7])$/.test(day.date));

// These are the activity facts available in the original local coaching dashboard.
// They are deliberately limited to recorded distance/duration; heart-rate is not fabricated.
export const referenceActivities = [
  ["2026-08-07", "Morning Run 🙂‍↕️", 20.0, 5820, 374, "i174898000"],
  ["2026-08-08", "Morning Run 🌤️", 10.3, 3480, 158, "i174906000"],
  ["2026-08-10", "Wienfluss Mornings 🌞", 14.7, 3960, 74, "i174923000"],
  ["2026-08-11", "Morning Run", 4.8, 1380, 35, "i174931000"],
  ["2026-08-12", "Windfluss Intervalle 💨", 14.0, 3300, 62, "i174991789"],
  ["2026-08-13", "Morning Gloriette 🔆", 8.4, 2520, 215, "i175702000"],
  ["2026-08-14", "Morning Laufen", 13.332, 3540, 54, "i175711283"],
  ["2026-08-16", "OÖ Runderl 🌤️", 23.008, 6780, 471, "i175728000"],
  ["2026-08-18", "Morning 4 × 2000 🦆", 12.007, 2820, 53, "i175746000"],
  ["2026-08-19", "Evening Run", 11.006, 3180, 60, "i175754000"],
  ["2026-08-20", "Morning Gloriette", 11.506, 3540, 313, "i175762000"],
] as const;

export const referencePerformance = [
  // Official results are retained as results, not treated as a current-fitness claim.
  ["2024-11-04", "Official result", null, null, 4495, null] as const,
  ["2025-04-06", "Official result", null, null, null, 10034] as const,
  ["2025-09-14", "Official result", null, null, null, 10294] as const,
  ["2026-01-25", "Official result", null, null, 4599, null] as const,
  ["2026-07-01", "Official result", 988, null, null, null] as const,
  // The current range is the conservative multi-signal estimate documented by the original coach engine.
  ["2026-08-20", "Personal Besties coach model", 991, 2124, 4545, 9900] as const,
] as const;
