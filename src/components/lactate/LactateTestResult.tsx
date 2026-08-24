import { useState } from "react";
import type { AxisMode, LactateTestResultData, TrainingZone } from "../../types/lactate";
import {
  formatDate,
  formatDuration,
  formatHeartRate,
  formatPace,
  formatSpeed,
} from "../../utils/format";
import { LactateChart } from "./LactateChart";
import "./lactate.css";

interface Props {
  data: LactateTestResultData;
  /** Optional earlier test for a subtle overlay comparison. */
  previousTest?: LactateTestResultData;
}

export function LactateTestResult({ data, previousTest }: Props) {
  const [axisMode, setAxisMode] = useState<AxisMode>("pace");
  const [showLactate, setShowLactate] = useState(true);
  const [showHeartRate, setShowHeartRate] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const hasAdvanced = (data.additionalThresholds?.length ?? 0) > 0;

  const metaParts = [
    formatDate(data.testDate),
    data.stageDurationSec ? formatDuration(data.stageDurationSec) + " min stages" : null,
    data.protocol,
    data.lab,
  ].filter(Boolean);

  return (
    <section className="ltr-root" aria-label="Lactate test result">
      <header className="ltr-header">
        <div>
          <h1 className="ltr-athlete">{data.athleteName}</h1>
          <div className="ltr-test-title">Lactate Performance Test</div>
          <div className="ltr-meta">{metaParts.join("  ·  ")}</div>
        </div>
        {previousTest && (
          <button
            type="button"
            className="ltr-chip-btn"
            aria-pressed={showComparison}
            onClick={() => setShowComparison((v) => !v)}
          >
            Compare with {formatDate(previousTest.testDate)}
          </button>
        )}
      </header>

      <div className="ltr-cards">
        <MetricCard
          dot="#189A55"
          label="LT1 · Aerobic threshold"
          pace={data.lt1 ? formatPace(data.lt1.paceSecPerKm) : "–"}
          sub={data.lt1 ? `${formatHeartRate(data.lt1.heartRateBpm)} · ${formatSpeed(data.lt1.speedKmh)}` : "not determined"}
          delta={showComparison ? paceDelta(data.lt1, previousTest?.lt1) : null}
        />
        <MetricCard
          dot="#E8930C"
          label="LT2 · Anaerobic threshold"
          pace={data.lt2 ? formatPace(data.lt2.paceSecPerKm) : "–"}
          sub={data.lt2 ? `${formatHeartRate(data.lt2.heartRateBpm)} · ${formatSpeed(data.lt2.speedKmh)}` : "not determined"}
          delta={showComparison ? paceDelta(data.lt2, previousTest?.lt2) : null}
        />
        <MetricCard
          dot="#1B2437"
          label="Max stage"
          pace={data.maxSpeedKmh ? formatPace(3600 / data.maxSpeedKmh) : "–"}
          sub={`${formatHeartRate(data.maxHeartRateBpm)} · ${data.maxSpeedKmh ? formatSpeed(data.maxSpeedKmh) : "–"}`}
        />
        {data.peakLactateMmol != null && (
          <MetricCard
            dot="#F0522D"
            label="Peak lactate"
            pace={data.peakLactateMmol.toFixed(2)}
            sub="at final stage"
            small
          />
        )}
      </div>

      <div className="ltr-controls">
        <div className="ltr-legend">
          <button
            type="button"
            className="ltr-legend-btn"
            aria-pressed={showLactate}
            onClick={() => setShowLactate((v) => !v)}
          >
            <span className="ltr-dot" style={{ background: "#F0522D" }} />
            Lactate
          </button>
          <button
            type="button"
            className="ltr-legend-btn"
            aria-pressed={showHeartRate}
            onClick={() => setShowHeartRate((v) => !v)}
          >
            <span className="ltr-dot" style={{ background: "#5D6DFF" }} />
            Heart rate
          </button>
        </div>
        <div className="ltr-controls-right">
          <div className="ltr-segmented" role="group" aria-label="X axis unit">
            <button type="button" aria-pressed={axisMode === "pace"} onClick={() => setAxisMode("pace")}>
              Pace
            </button>
            <button type="button" aria-pressed={axisMode === "speed"} onClick={() => setAxisMode("speed")}>
              Speed
            </button>
          </div>
          {hasAdvanced && (
            <button
              type="button"
              className="ltr-chip-btn"
              aria-pressed={advanced}
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide analysis details" : "Advanced analysis"}
            </button>
          )}
        </div>
      </div>

      <LactateChart
        data={data}
        previous={showComparison ? previousTest : undefined}
        axisMode={axisMode}
        showLactate={showLactate}
        showHeartRate={showHeartRate}
        advanced={advanced}
      />
      {showComparison && previousTest && <ComparisonNote current={data} previous={previousTest} />}

      {data.trainingZones && data.trainingZones.length > 0 && (
        <ZoneTable zones={data.trainingZones} />
      )}
    </section>
  );
}

function paceDelta(
  cur: { paceSecPerKm: number } | undefined,
  prev: { paceSecPerKm: number } | undefined,
): { sec: number } | null {
  if (!cur || !prev) return null;
  return { sec: Math.round(cur.paceSecPerKm - prev.paceSecPerKm) };
}

function ComparisonNote({ current, previous }: { current: LactateTestResultData; previous: LactateTestResultData }) {
  const parts: string[] = [];
  if (current.lt2 && previous.lt2) {
    const d = Math.round(previous.lt2.paceSecPerKm - current.lt2.paceSecPerKm);
    parts.push(`LT2 pace ${d >= 0 ? `${d} s/km faster` : `${-d} s/km slower`}`);
    if (current.lt2.heartRateBpm != null && previous.lt2.heartRateBpm != null) {
      const dh = current.lt2.heartRateBpm - previous.lt2.heartRateBpm;
      parts.push(`LT2 HR ${dh >= 0 ? "+" : ""}${dh} bpm`);
    }
  }
  if (current.lt1 && previous.lt1) {
    const d = Math.round(previous.lt1.paceSecPerKm - current.lt1.paceSecPerKm);
    parts.push(`LT1 pace ${d >= 0 ? `${d} s/km faster` : `${-d} s/km slower`}`);
  }
  return (
    <p className="ltr-compare-note">
      Gray overlay: {formatDate(previous.testDate)}. {parts.join(" · ")}.
      {current.lt1?.method !== previous.lt1?.method && " Note: threshold methods differ between labs."}
    </p>
  );
}

interface MetricCardProps {
  dot: string;
  label: string;
  pace: string;
  sub: string;
  delta?: { sec: number } | null;
  small?: boolean;
}

function MetricCard({ dot, label, pace, sub, delta, small }: MetricCardProps) {
  const improved = delta != null && delta.sec < 0;
  return (
    <div className={`ltr-card${small ? " ltr-card-small" : ""}`}>
      <div className="ltr-card-label">
        <span className="ltr-dot" style={{ background: dot }} />
        {label}
      </div>
      <div className="ltr-card-value">
        {pace}
        {small && <span className="ltr-card-unit"> mmol/L</span>}
        {!small && <span className="ltr-card-unit"> /km</span>}
      </div>
      <div className="ltr-card-sub">
        {sub}
        {delta && delta.sec !== 0 && (
          <span className={`ltr-delta ${improved ? "is-better" : "is-worse"}`}>
            {" "}
            {improved ? "▼" : "▲"} {Math.abs(delta.sec)} s/km
          </span>
        )}
      </div>
    </div>
  );
}

function ZoneTable({ zones }: { zones: TrainingZone[] }) {
  return (
    <div className="ltr-zones">
      <h2 className="ltr-zones-title">Training zones</h2>
      <div className="ltr-zones-scroll">
        <table className="ltr-zone-table">
          <thead>
            <tr>
              <th scope="col">Zone</th>
              <th scope="col">Pace</th>
              <th scope="col">Heart rate</th>
              <th scope="col">Speed</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td>
                  <span className="ltr-zone-name">{z.label}</span>
                  {z.shortLabel && z.shortLabel.toLowerCase() !== z.label.toLowerCase() && (
                    <span className="ltr-zone-alt">{z.shortLabel}</span>
                  )}
                </td>
                <td>{paceRange(z)}</td>
                <td>{hrRange(z)}</td>
                <td>{speedRange(z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function paceRange(z: TrainingZone): string {
  const hasMin = z.minSpeedKmh != null;
  const hasMax = z.maxSpeedKmh != null;
  if (!hasMin && !hasMax) return "–";
  if (!hasMin) return `< ${formatPace(3600 / z.maxSpeedKmh!)} /km`;
  if (!hasMax) return `> ${formatPace(3600 / z.minSpeedKmh!)} /km`;
  return `${formatPace(3600 / z.minSpeedKmh!)}–${formatPace(3600 / z.maxSpeedKmh!)} /km`;
}

function hrRange(z: TrainingZone): string {
  const hasMin = z.minHeartRate != null;
  const hasMax = z.maxHeartRate != null;
  if (!hasMin && !hasMax) return "–";
  if (!hasMin) return `< ${z.maxHeartRate} bpm`;
  if (!hasMax) return `> ${z.minHeartRate} bpm`;
  return `${z.minHeartRate}–${z.maxHeartRate} bpm`;
}

function speedRange(z: TrainingZone): string {
  const hasMin = z.minSpeedKmh != null;
  const hasMax = z.maxSpeedKmh != null;
  if (!hasMin && !hasMax) return "–";
  if (!hasMin) return `< ${z.maxSpeedKmh!.toFixed(1)} km/h`;
  if (!hasMax) return `> ${z.minSpeedKmh!.toFixed(1)} km/h`;
  return `${z.minSpeedKmh!.toFixed(1)}–${z.maxSpeedKmh!.toFixed(1)} km/h`;
}
