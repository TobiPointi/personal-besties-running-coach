import type { PipelineTestRaw } from "../utils/lactateAdapter";

/**
 * Real test results, transcribed from the lab reports (SIM Linz 2026,
 * Ergonizer/Universität Wien 2023–2024). In production these objects
 * come from the lactate-test analysis pipeline instead.
 */

export const latestTest: PipelineTestRaw = {
  title: "Tobias Pointner",
  lab: "SIM Linz",
  date: "2026-05-26",
  protocol: "Treadmill step test · Freiburg model",
  stage_min: 4,
  stages: [
    { speed: 8.0, hr: 117, lact: 0.82 },
    { speed: 10.0, hr: 129, lact: 0.84 },
    { speed: 12.0, hr: 147, lact: 0.98 },
    { speed: 14.0, hr: 164, lact: 1.46 },
    { speed: 16.0, hr: 181, lact: 3.12 },
    { speed: 18.0, hr: 191, lact: 5.41 },
    { speed: 19.3, hr: 198, lact: 8.58, duration_sec: 150 },
  ],
  thresholds: {
    LT1: { label: "Ind. aerobe Schwelle", speed: 10.4, hr: 132, lact: 0.91 },
    LT2: { label: "Dickhuth IANS", speed: 15.5, hr: 177, lact: 2.41 },
    Freiburg: { label: "Freiburg model", speed: 15.4, hr: 176, lact: 2.38 },
    Dmax: { label: "Dmax", speed: 15.5, hr: 176, lact: 2.4 },
    Winkel: { label: "Winkel tangent", speed: 16.4, hr: 183, lact: 3.16 },
  },
  zones: [
    { name: "REG", lo: null, hi: 11.7, hr_lo: null, hr_hi: 145 },
    { name: "GA-ext", lo: 11.7, hi: 13.8, hr_lo: 145, hr_hi: 162 },
    { name: "GA-int", lo: 13.8, hi: 14.9, hr_lo: 162, hr_hi: 171 },
    { name: "SB", lo: 14.9, hi: 15.6, hr_lo: 171, hr_hi: 178 },
    { name: "SB+", lo: 15.6, hi: 16.1, hr_lo: 178, hr_hi: 181 },
  ],
  max: { speed: 19.3, hr: 198, lact: 8.58 },
};

export const previousTest: PipelineTestRaw = {
  title: "Tobias Pointner",
  lab: "Universität Wien (Ergonizer)",
  date: "2024-04-03",
  protocol: "Treadmill step test",
  stage_min: 3,
  stages: [
    { speed: 6.0, hr: 94, lact: 0.83 },
    { speed: 7.5, hr: 115, lact: 0.91 },
    { speed: 9.0, hr: 126, lact: 0.78 },
    { speed: 10.5, hr: 135, lact: 0.85 },
    { speed: 12.0, hr: 144, lact: 1.04 },
    { speed: 13.5, hr: 158, lact: 1.42 },
    { speed: 15.0, hr: 170, lact: 2.24 },
    { speed: 16.5, hr: 180, lact: 3.85 },
    { speed: 18.0, hr: 187, lact: 6.12 },
    { speed: 19.5, hr: 193, lact: 10.13 },
  ],
  thresholds: {
    LT1: { label: "Lactate Threshold (lab)", speed: 11.3, hr: 142, lact: 0.9 },
    LT2: { label: "IAS (Dickhuth)", speed: 15.1, hr: 171, lact: 2.41 },
  },
  zones: [
    { name: "REG", lo: null, hi: 12.1, hr_lo: null, hr_hi: 147 },
    { name: "GA1-2", lo: 12.1, hi: 15.0, hr_lo: 148, hr_hi: 169 },
    { name: "GA2", lo: 15.0, hi: 17.1, hr_lo: 170, hr_hi: 182 },
    { name: "WSA", lo: 17.1, hi: null, hr_lo: 183, hr_hi: 192 },
  ],
  max: { speed: 19.5, hr: 193, lact: 10.13 },
};
