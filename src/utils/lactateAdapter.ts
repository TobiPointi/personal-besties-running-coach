import type {
  AdditionalThreshold,
  LactateStage,
  LactateTestResultData,
  Threshold,
  TrainingZone,
} from "../types/lactate";
import { speedToPaceSec } from "../utils/format";

/**
 * Raw stage/threshold/zone objects as emitted by the lactate analysis
 * pipeline (Python tracker / lab reports). Field names are snake_case
 * there; this adapter maps them onto the frontend model without the
 * chart components having to know about pipeline internals.
 */
export interface PipelineStageRaw {
  speedKmh?: number;
  speed?: number;
  speed_kmh?: number;
  hr?: number | null;
  heartRateBpm?: number | null;
  lact?: number;
  lactateMmol?: number;
  durationSec?: number;
  duration_sec?: number;
}

export interface PipelineThresholdRaw {
  speed?: number;
  hr?: number;
  heartRateBpm?: number;
  lact?: number;
  lactateMmol?: number;
  label?: string;
  method?: string;
}

export interface PipelineZoneRaw {
  name?: string;
  label?: string;
  lo?: number | null;
  hi?: number | null;
  minSpeedKmh?: number;
  maxSpeedKmh?: number;
  hr_lo?: number | null;
  hr_hi?: number | null;
  minHeartRate?: number;
  maxHeartRate?: number;
}

export interface PipelineTestRaw {
  title?: string;
  athleteName?: string;
  date?: string;
  testDate?: string;
  protocol?: string;
  lab?: string;
  stage_min?: number;
  stageDurationSec?: number;
  stages: PipelineStageRaw[];
  thresholds?: Record<string, PipelineThresholdRaw | undefined>;
  zones?: PipelineZoneRaw[];
  max?: { speed?: number; hr?: number; lact?: number };
  maxSpeedKmh?: number;
  maxHeartRateBpm?: number;
  peakLactateMmol?: number;
}

const FRIENDLY_ZONE_NAMES: Record<string, string> = {
  REG: "Recovery",
  "REG/GA1": "Recovery",
  "GA-ext": "Aerobic",
  GA1: "Aerobic",
  "GA1-2": "Aerobic",
  "GA-int": "Steady",
  GA2: "Steady",
  SB: "Threshold",
  WSA: "Threshold",
  "SB+": "High",
};

function stageFromRaw(raw: PipelineStageRaw): LactateStage {
  const speedKmh = raw.speedKmh ?? raw.speed_kmh ?? raw.speed ?? 0;
  return {
    speedKmh,
    paceSecPerKm: speedToPaceSec(speedKmh),
    heartRateBpm: raw.heartRateBpm ?? raw.hr ?? null,
    lactateMmol: raw.lactateMmol ?? raw.lact ?? 0,
    durationSec: raw.durationSec ?? raw.duration_sec,
  };
}

function thresholdFromRaw(raw: PipelineThresholdRaw | undefined): Threshold | undefined {
  if (!raw || !raw.speed) return undefined;
  return {
    speedKmh: raw.speed,
    paceSecPerKm: speedToPaceSec(raw.speed),
    heartRateBpm: raw.heartRateBpm ?? raw.hr,
    lactateMmol: raw.lactateMmol ?? raw.lact,
    method: raw.method ?? raw.label,
  };
}

function zonesFromRaw(zones: PipelineZoneRaw[] | undefined): TrainingZone[] | undefined {
  if (!zones || zones.length === 0) return undefined;
  return zones.map((z, i) => {
    const rawName = z.label ?? z.name ?? `Zone ${i + 1}`;
    const shortLabel = rawName;
    const label = FRIENDLY_ZONE_NAMES[rawName] ?? rawName;
    const minSpeedKmh = z.minSpeedKmh ?? (z.lo == null ? undefined : z.lo);
    const maxSpeedKmh = z.maxSpeedKmh ?? (z.hi == null ? undefined : z.hi);
    const minHeartRate = z.minHeartRate ?? (z.hr_lo == null ? undefined : z.hr_lo);
    const maxHeartRate = z.maxHeartRate ?? (z.hr_hi == null ? undefined : z.hr_hi);
    return {
      id: shortLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label,
      shortLabel,
      minSpeedKmh,
      maxSpeedKmh,
      minHeartRate,
      maxHeartRate,
    };
  });
}

export function toLactateTestResultData(raw: PipelineTestRaw): LactateTestResultData {
  const stages = raw.stages.map(stageFromRaw);
  const th = raw.thresholds ?? {};
  const additional: AdditionalThreshold[] = Object.entries(th)
    .filter(([key, t]) => t && !["LT1", "LT2"].includes(key) && t.speed)
    .map(([key, t]) => ({
      label: t!.label ?? key,
      speedKmh: t!.speed!,
      heartRateBpm: t!.heartRateBpm ?? t!.hr,
      lactateMmol: t!.lactateMmol ?? t!.lact,
      method: t!.method ?? t!.label,
    }));

  const peakFromStages = stages.length
    ? stages.reduce((max, s) => Math.max(max, s.lactateMmol), 0)
    : undefined;
  const maxStage = stages.length
    ? stages.reduce((a, b) => (b.speedKmh > a.speedKmh ? b : a))
    : undefined;

  return {
    athleteName: raw.athleteName ?? raw.title ?? "Athlete",
    testDate: raw.testDate ?? raw.date ?? "",
    protocol: raw.protocol,
    stageDurationSec: raw.stageDurationSec ?? (raw.stage_min ? raw.stage_min * 60 : undefined),
    lab: raw.lab,
    stages,
    lt1: thresholdFromRaw(th.LT1),
    lt2: thresholdFromRaw(th.LT2),
    maxSpeedKmh: raw.maxSpeedKmh ?? maxStage?.speedKmh,
    maxHeartRateBpm: raw.maxHeartRateBpm ?? maxStage?.heartRateBpm ?? undefined,
    peakLactateMmol: raw.peakLactateMmol ?? raw.max?.lact ?? peakFromStages,
    trainingZones: zonesFromRaw(raw.zones),
    additionalThresholds: additional.length ? additional : undefined,
  };
}
