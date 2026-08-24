export interface LactateStage {
  speedKmh: number;
  paceSecPerKm?: number;
  heartRateBpm: number | null;
  lactateMmol: number;
  durationSec?: number;
}

export interface Threshold {
  speedKmh: number;
  paceSecPerKm: number;
  heartRateBpm?: number;
  lactateMmol?: number;
  method?: string;
}

export interface TrainingZone {
  id: string;
  label: string;
  shortLabel?: string;
  minSpeedKmh?: number;
  maxSpeedKmh?: number;
  minHeartRate?: number;
  maxHeartRate?: number;
}

export interface AdditionalThreshold {
  label: string;
  speedKmh: number;
  heartRateBpm?: number;
  lactateMmol?: number;
  method?: string;
}

export interface LactateTestResultData {
  athleteName: string;
  testDate: string;
  protocol?: string;
  stageDurationSec?: number;
  lab?: string;

  stages: LactateStage[];

  lt1?: Threshold;
  lt2?: Threshold;

  maxSpeedKmh?: number;
  maxHeartRateBpm?: number;
  peakLactateMmol?: number;

  trainingZones?: TrainingZone[];
  additionalThresholds?: AdditionalThreshold[];
}

export type AxisMode = "pace" | "speed";
export type TooltipState =
  | { kind: "stage"; index: number }
  | { kind: "threshold"; which: "lt1" | "lt2" }
  | { kind: "additional"; index: number }
  | null;
