import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AdditionalThreshold,
  AxisMode,
  LactateTestResultData,
  Threshold,
  TooltipState,
} from "../../types/lactate";
import { resampleCurve } from "../../utils/curve";
import {
  formatDuration,
  formatHeartRate,
  formatLactate,
  formatPace,
  formatSpeed,
  speedToPaceSec,
} from "../../utils/format";
import "./lactate.css";

const C = {
  lactate: "#F0522D",
  hr: "#5D6DFF",
  lt1: "#189A55",
  lt2: "#E8930C",
  gray: "#98A1B2",
  text: "#1B2437",
  muted: "#6E7787",
  faint: "#A9B1C0",
  grid: "#EFEDE8",
  surface: "#FFFFFF",
};

const PACE_TICKS_SEC = [480, 420, 390, 360, 330, 300, 270, 255, 240, 225, 210, 195, 180];

interface Props {
  data: LactateTestResultData;
  /** Earlier test rendered as a subtle gray overlay. */
  previous?: LactateTestResultData;
  axisMode: AxisMode;
  showLactate: boolean;
  showHeartRate: boolean;
  advanced: boolean;
}

interface Geometry {
  width: number;
  height: number;
  m: { top: number; right: number; bottom: number; left: number };
  plotW: number;
  plotH: number;
  plotBottom: number;
  dmin: number;
  dmax: number;
  lacMax: number;
  hrMin: number;
  hrMax: number;
  xScale: (v: number) => number;
  yLac: (v: number) => number;
  yHr: (v: number) => number;
}

function measureText(text: string, font: string): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * 6;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export function LactateChart({ data, previous, axisMode, showLactate, showHeartRate, advanced }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el && el.clientWidth > 0) setWidth(Math.max(300, el.clientWidth));
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(300, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);  const geo = useMemo<Geometry | null>(() => {
    if (data.stages.length === 0) return null;
    const height = width < 640 ? 330 : 410;
    const m = { top: 52, right: width < 640 ? 44 : 58, bottom: 78, left: width < 640 ? 38 : 50 };
    const plotW = width - m.left - m.right;
    const plotBottom = height - m.bottom;
    const plotH = plotBottom - m.top;
    if (plotW < 120 || plotH < 100) return null;

    const speeds = data.stages.map((s) => s.speedKmh);
    const lacts = data.stages.map((s) => s.lactateMmol);
    const dmin = Math.floor((Math.min(...speeds) - 0.4) * 2) / 2;
    const dmax = Math.ceil((Math.max(...speeds) + 0.4) * 2) / 2;
    const lacMax = Math.max(Math.ceil(Math.max(...lacts) + 1), 4);
    const hrs = data.stages.map((s) => s.heartRateBpm).filter((h): h is number => h != null);
    const hrMin = hrs.length ? Math.max(60, Math.floor((Math.min(...hrs) - 12) / 20) * 20) : 60;
    const hrMax = hrs.length ? Math.ceil((Math.max(...hrs) + 12) / 20) * 20 : 200;

    const xScale = (v: number) => m.left + ((v - dmin) / (dmax - dmin)) * plotW;
    const yLac = (v: number) => plotBottom - (v / lacMax) * plotH;
    const yHr = (v: number) => plotBottom - ((v - hrMin) / (hrMax - hrMin)) * plotH;
    return { width, height, m, plotW, plotH, plotBottom, dmin, dmax, lacMax, hrMin, hrMax, xScale, yLac, yHr };
  }, [data.stages, width]);

  const curve = useMemo(() => {
    if (!geo || !showLactate || data.stages.length < 2) return "";
    const pts = resampleCurve(
      data.stages.map((s) => s.speedKmh),
      data.stages.map((s) => s.lactateMmol),
    );
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${geo.xScale(p.x).toFixed(1)},${geo.yLac(p.y).toFixed(1)}`).join(" ");
  }, [geo, data.stages, showLactate]);

  const previousCurve = useMemo(() => {
    if (!geo || !showLactate || !previous || previous.stages.length < 2) return null;
    const pts = resampleCurve(
      previous.stages.map((s) => s.speedKmh),
      previous.stages.map((s) => s.lactateMmol),
      120,
    );
    return {
      path: pts.map((p, i) => `${i === 0 ? "M" : "L"}${geo.xScale(p.x).toFixed(1)},${geo.yLac(p.y).toFixed(1)}`).join(" "),
      dots: previous.stages.map((s) => ({ x: geo.xScale(s.speedKmh), y: geo.yLac(s.lactateMmol) })),
    };
  }, [geo, previous, showLactate]);

  const closeTooltipLater = useCallback(() => setTooltip(null), []);

  const hitTest = useCallback(
    (px: number, py: number): TooltipState => {
      if (!geo) return null;
      const near = (v: number) => Math.abs(geo.xScale(v) - px);
      if (data.lt2 && near(data.lt2.speedKmh) < 12) return { kind: "threshold", which: "lt2" };
      if (data.lt1 && near(data.lt1.speedKmh) < 12) return { kind: "threshold", which: "lt1" };
      if (advanced && data.additionalThresholds) {
        for (let i = 0; i < data.additionalThresholds.length; i++) {
          const t = data.additionalThresholds[i];
          if (near(t.speedKmh) < 12) return { kind: "additional", index: i };
        }
      }
      let best = -1;
      let bestDist = 28;
      data.stages.forEach((s, i) => {
        const d = Math.abs(geo.xScale(s.speedKmh) - px);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best >= 0 && py > geo.m.top - 10 && py < geo.plotBottom + 10) return { kind: "stage", index: best };
      return null;
    },
    [geo, data, advanced],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip(hitTest(e.clientX - rect.left, e.clientY - rect.top));
    },
    [hitTest],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!geo) return;
      e.preventDefault();
      if (e.key === "Escape") {
        closeTooltipLater();
        return;
      }
      const n = data.stages.length;
      if (n === 0) return;
      setTooltip((prev) => {
        const cur = prev?.kind === "stage" ? prev.index : -1;
        if (e.key === "ArrowRight") return { kind: "stage", index: Math.min(cur + 1, n - 1) };
        if (e.key === "ArrowLeft") return { kind: "stage", index: Math.max(cur - 1, 0) };
        if (e.key === "Home") return { kind: "stage", index: 0 };
        if (e.key === "End") return { kind: "stage", index: n - 1 };
        return prev;
      });
    },
    [geo, data.stages.length, closeTooltipLater],
  );

  if (!geo) {
    return (
      <div className="ltr-chart-empty" ref={wrapRef}>
        No stage data available.
      </div>
    );
  }

  const { xScale, yLac, yHr, plotBottom, m, dmin, dmax, lacMax, hrMin, hrMax } = geo;

  const xTicks: Array<{ v: number; label: string }> = (() => {
    const raw =
      axisMode === "pace"
        ? PACE_TICKS_SEC.map((p) => ({ v: 3600 / p, label: formatPace(p) })).filter(
            (t) => t.v >= dmin && t.v <= dmax,
          )
        : speedTicks(dmin, dmax);
    const minGap = axisMode === "pace" ? 52 : 64;
    const thinned: Array<{ v: number; label: string }> = [];
    let lastPx = -Infinity;
    for (const t of raw) {
      const px = xScale(t.v);
      if (px - lastPx >= minGap || lastPx === -Infinity) {
        thinned.push(t);
        lastPx = px;
      }
    }
    return thinned;
  })();

  const lacTicks: number[] = [];
  const lacStep = lacMax > 6 ? 2 : 1;
  for (let v = 0; v <= lacMax; v += lacStep) lacTicks.push(v);

  const hrTicks: number[] = [];
  for (let v = hrMin + 20; v < hrMax; v += 40) hrTicks.push(v);

  const maxStageIdx = data.stages.reduce(
    (best, s, i) => (s.speedKmh > data.stages[best].speedKmh ? i : best),
    0,
  );

  interface Pill {
    x: number;
    row: number;
    w: number;
    lines: [string, string];
    color: string;
    id: string;
  }
  const pills: Pill[] = [];
  const addPill = (t: Threshold | undefined, id: string, title: string, color: string) => {
    if (!t) return;
    const line1 = title;
    const line2 = `${formatPace(t.paceSecPerKm)} /km · ${formatHeartRate(t.heartRateBpm)}`;
    const w = Math.max(measureText(line1, "600 11px system-ui"), measureText(line2, "10px system-ui")) + 20;
    pills.push({ x: xScale(t.speedKmh), row: 0, w, lines: [line1, line2], color, id });
  };
  addPill(data.lt1, "lt1", "LT1 · Aerobic", C.lt1);
  addPill(data.lt2, "lt2", "LT2 · Threshold", C.lt2);
  const maxSpeed = data.maxSpeedKmh ?? data.stages[maxStageIdx]?.speedKmh;
  if (maxSpeed != null) {
    const line = `Max · ${formatPace(speedToPaceSec(maxSpeed))} /km`;
    pills.push({
      x: xScale(maxSpeed),
      row: 0,
      w: measureText(line, "600 10px system-ui") + 18,
      lines: [line, ""],
      color: C.gray,
      id: "max",
    });
  }
  pills.sort((a, b) => a.x - b.x);
  for (let i = 1; i < pills.length; i++) {
    const prev = pills[i - 1];
    if (pills[i].row === prev.row && pills[i].x - pills[i].w / 2 < prev.x + prev.w / 2 + 8) {
      pills[i].row = prev.row + 1;
    }
  }

  const tooltipContent = (() => {
    if (!tooltip) return null;
    if (tooltip.kind === "stage") {
      const s = data.stages[tooltip.index];
      if (!s) return null;
      return {
        title: `Stage ${tooltip.index + 1}`,
        rows: [
          ["Pace", `${formatPace(s.paceSecPerKm ?? speedToPaceSec(s.speedKmh))} /km`],
          ["Speed", formatSpeed(s.speedKmh)],
          ["Heart rate", formatHeartRate(s.heartRateBpm)],
          ["Lactate", formatLactate(s.lactateMmol)],
          ...(s.durationSec ? ([["Duration", formatDuration(s.durationSec)]] as Array<[string, string]>) : []),
        ] as Array<[string, string]>,
        accent: C.lactate,
      };
    }
    if (tooltip.kind === "threshold") {
      const t = tooltip.which === "lt1" ? data.lt1 : data.lt2;
      if (!t) return null;
      return {
        title: `${tooltip.which.toUpperCase()} · ${tooltip.which === "lt1" ? "Aerobic threshold" : "Anaerobic threshold"}`,
        rows: [
          ["Pace", `${formatPace(t.paceSecPerKm)} /km`],
          ["Speed", formatSpeed(t.speedKmh)],
          ...(t.heartRateBpm != null ? ([["Heart rate", formatHeartRate(t.heartRateBpm)]] as Array<[string, string]>) : []),
          ...(t.lactateMmol != null ? ([["Lactate", formatLactate(t.lactateMmol)]] as Array<[string, string]>) : []),
          ...(t.method ? ([["Method", t.method]] as Array<[string, string]>) : []),
        ],
        accent: tooltip.which === "lt1" ? C.lt1 : C.lt2,
      };
    }
    const t: AdditionalThreshold | undefined = data.additionalThresholds?.[tooltip.index];
    if (!t) return null;
    return {
      title: t.label,
      rows: [
        ["Speed", formatSpeed(t.speedKmh)],
        ...(t.heartRateBpm != null ? ([["Heart rate", formatHeartRate(t.heartRateBpm)]] as Array<[string, string]>) : []),
        ...(t.lactateMmol != null ? ([["Lactate", formatLactate(t.lactateMmol)]] as Array<[string, string]>) : []),
        ...(t.method ? ([["Method", t.method]] as Array<[string, string]>) : []),
      ],
      accent: C.gray,
    };
  })();

  const tipAnchor = (() => {
    if (!tooltip) return null;
    if (tooltip.kind === "stage") {
      const s = data.stages[tooltip.index];
      return { x: xScale(s.speedKmh), y: Math.min(yLac(s.lactateMmol), s.heartRateBpm != null ? yHr(s.heartRateBpm) : Infinity) };
    }
    if (tooltip.kind === "threshold") {
      const t = tooltip.which === "lt1" ? data.lt1 : data.lt2;
      return t ? { x: xScale(t.speedKmh), y: yLac(t.lactateMmol ?? 0) } : null;
    }
    const t = data.additionalThresholds?.[tooltip.index];
    return t ? { x: xScale(t.speedKmh), y: yLac(t.lactateMmol ?? 0) } : null;
  })();

  const hoveredStage = tooltip?.kind === "stage" ? tooltip.index : -1;
  const ribbonTop = plotBottom + 40;
  const ribbonH = 20;

  return (
    <div className="ltr-chart-wrap" ref={wrapRef}>
      <div
        className="ltr-chart-focus"
        style={{ height: geo.height }}
        tabIndex={0}
        role="group"
        aria-label="Interactive lactate curve. Use left and right arrow keys to inspect stages, escape to close details."
        onKeyDown={onKeyDown}
        onBlur={closeTooltipLater}
      >
        <svg width={geo.width} height={geo.height} className="ltr-svg">
          {/* grid + lactate axis */}
          {lacTicks.map((v) => (
            <g key={`lac-${v}`}>
              <line x1={m.left} x2={m.left + geo.plotW} y1={yLac(v)} y2={yLac(v)} stroke={C.grid} strokeWidth={1} />
              <text x={m.left - 8} y={yLac(v) + 3.5} textAnchor="end" fontSize={10.5} fill={C.faint}>
                {v}
              </text>
            </g>
          ))}
          <text x={m.left - 8} y={m.top - 30} textAnchor="end" fontSize={10} fill={C.muted}>
            mmol/L
          </text>
          {showHeartRate && (
            <>
              {hrTicks.map((v) => (
                <text key={`hr-${v}`} x={m.left + geo.plotW + 8} y={yHr(v) + 3.5} fontSize={10.5} fill={C.faint}>
                  {v}
                </text>
              ))}
              <text x={m.left + geo.plotW + 8} y={m.top - 30} fontSize={10} fill={C.hr}>
                bpm
              </text>
            </>
          )}

          {/* x ticks */}
          {xTicks.map((t) => (
            <g key={`x-${t.label}`}>
              <line x1={xScale(t.v)} x2={xScale(t.v)} y1={plotBottom} y2={plotBottom + 5} stroke={C.faint} />
              <text x={xScale(t.v)} y={plotBottom + 18} textAnchor="middle" fontSize={10.5} fill={C.muted}>
                {axisMode === "pace" ? t.label : t.label.replace(" km/h", "")}
              </text>
            </g>
          ))}
          <text x={m.left + geo.plotW / 2} y={plotBottom + 32} textAnchor="middle" fontSize={10} fill={C.faint}>
            {axisMode === "pace" ? "Pace (min/km) · faster →" : "Speed (km/h)"}
          </text>

          {/* advanced: fixed reference lines */}
          {advanced && showLactate && [2, 4].map((ref) =>
            ref < lacMax ? (
              <g key={`ref-${ref}`}>
                <line x1={m.left} x2={m.left + geo.plotW} y1={yLac(ref)} y2={yLac(ref)} stroke={C.gray} strokeDasharray="2 4" strokeWidth={1} opacity={0.55} />
                <text x={m.left + geo.plotW - 4} y={yLac(ref) - 4} textAnchor="end" fontSize={9} fill={C.gray}>
                  {ref.toFixed(1)} mmol/L
                </text>
              </g>
            ) : null,
          )}

          {/* previous test overlay (comparison) */}
          {previousCurve && (
            <g opacity={0.45}>
              <path d={previousCurve.path} fill="none" stroke={C.gray} strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" />
              {previousCurve.dots.map((d, i) => (
                <circle key={`prevd-${i}`} cx={d.x} cy={d.y} r={3} fill={C.gray} />
              ))}
            </g>
          )}

          {/* heart rate series */}
          {showHeartRate && (
            <g>
              <polyline
                points={data.stages
                  .filter((s) => s.heartRateBpm != null)
                  .map((s) => `${xScale(s.speedKmh).toFixed(1)},${yHr(s.heartRateBpm!).toFixed(1)}`)
                  .join(" ")}
                fill="none"
                stroke={C.hr}
                strokeWidth={1.75}
                opacity={0.85}
                strokeLinejoin="round"
              />
              {data.stages.map(
                (s, i) =>
                  s.heartRateBpm != null && (
                    <circle key={`hrd-${i}`} cx={xScale(s.speedKmh)} cy={yHr(s.heartRateBpm)} r={2.6} fill={C.hr} opacity={0.9} />
                  ),
              )}
            </g>
          )}

          {/* lactate curve + measured points */}
          {showLactate && (
            <g>
              {curve && <path d={curve} fill="none" stroke={C.lactate} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
              {data.stages.map((s, i) => (
                <circle
                  key={`lacd-${i}`}
                  cx={xScale(s.speedKmh)}
                  cy={yLac(s.lactateMmol)}
                  r={i === hoveredStage ? 5.5 : 4.2}
                  fill={C.lactate}
                  stroke={C.surface}
                  strokeWidth={1.8}
                />
              ))}
            </g>
          )}

          {/* advanced: secondary thresholds */}
          {advanced &&
            data.additionalThresholds?.map((t, i) => {
              const x = xScale(t.speedKmh);
              const y = yLac(t.lactateMmol ?? 0);
              return (
                <g key={`adv-${i}`}>
                  <path d={`M${x},${y - 5} L${x + 5},${y} L${x},${y + 5} L${x - 5},${y} Z`} fill={C.gray} stroke={C.surface} strokeWidth={1.2} />
                  <text x={x + (i % 2 === 0 ? -8 : 8)} y={y + 18 + (i % 3) * 9} textAnchor={i % 2 === 0 ? "end" : "start"} fontSize={9} fill={C.gray}>
                    {t.label}
                  </text>
                </g>
              );
            })}

          {/* threshold verticals */}
          {(["lt1", "lt2"] as const).map((which) => {
            const t = which === "lt1" ? data.lt1 : data.lt2;
            if (!t) return null;
            const color = which === "lt1" ? C.lt1 : C.lt2;
            return (
              <line
                key={which}
                x1={xScale(t.speedKmh)}
                x2={xScale(t.speedKmh)}
                y1={m.top - 2}
                y2={plotBottom}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                opacity={0.75}
              />
            );
          })}

          {/* max stage ring */}
          {showLactate && data.stages[maxStageIdx] && (
            <circle
              cx={xScale(data.stages[maxStageIdx].speedKmh)}
              cy={yLac(data.stages[maxStageIdx].lactateMmol)}
              r={7.5}
              fill="none"
              stroke={C.lactate}
              strokeWidth={1.6}
              opacity={0.65}
            />
          )}

          {/* hover guide */}
          {hoveredStage >= 0 && data.stages[hoveredStage] && (
            <line
              x1={xScale(data.stages[hoveredStage].speedKmh)}
              x2={xScale(data.stages[hoveredStage].speedKmh)}
              y1={m.top}
              y2={plotBottom}
              stroke={C.faint}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          )}

          {/* floating pills */}
          {pills.map((p) => {
            const cx = Math.min(Math.max(p.x, m.left + p.w / 2), m.left + geo.plotW - p.w / 2);
            const y = m.top - 44 + p.row * 40;
            return (
              <g key={`pill-${p.id}`} className="ltr-pill">
                <rect x={cx - p.w / 2} y={y} width={p.w} height={p.lines[1] ? 34 : 22} rx={8} fill={C.surface} stroke={p.color} strokeWidth={1.2} />
                <text x={cx} y={y + (p.lines[1] ? 13.5 : 14.5)} textAnchor="middle" fontSize={p.lines[1] ? 10.5 : 10} fontWeight={600} fill={p.color}>
                  {p.lines[0]}
                </text>
                {p.lines[1] && (
                  <text x={cx} y={y + 27} textAnchor="middle" fontSize={10} fill={C.muted}>
                    {p.lines[1]}
                  </text>
                )}
              </g>
            );
          })}

          {/* training-zone ribbon */}
          {data.trainingZones && data.trainingZones.length > 0 && (
            <g>
              <text x={m.left} y={ribbonTop - 6} fontSize={9.5} fill={C.faint}>
                Training zones
              </text>
              {data.trainingZones.map((z, i) => {
                const lo = z.minSpeedKmh ?? dmin;
                const hi = z.maxSpeedKmh ?? dmax;
                const x1 = Math.max(xScale(lo), m.left);
                const x2 = Math.min(xScale(hi), m.left + geo.plotW);
                if (x2 - x1 < 1) return null;
                const label = x2 - x1 > measureText(z.label, "9.5px system-ui") + 12 ? z.label : z.shortLabel;
                const showLabel = x2 - x1 > (label ? measureText(label, "9.5px system-ui") + 8 : 8);
                return (
                  <g key={z.id}>
                    <rect x={x1} y={ribbonTop} width={x2 - x1} height={ribbonH} fill={i % 2 === 0 ? "#F1EFE9" : "#E7E5DE"}>
                      <title>{`${z.label}${z.shortLabel && z.shortLabel !== z.label ? ` (${z.shortLabel})` : ""}`}</title>
                    </rect>
                    {showLabel && label && (
                      <text x={(x1 + x2) / 2} y={ribbonTop + 13.5} textAnchor="middle" fontSize={9.5} fill={C.muted} fontWeight={500}>
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* interaction overlay */}
          <rect
            x={m.left}
            y={m.top - 10}
            width={geo.plotW}
            height={plotBottom - m.top + 10}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerDown={onPointerMove}
            onPointerLeave={closeTooltipLater}
          />
        </svg>

        {tooltipContent && tipAnchor && (
          <div
            className="ltr-tooltip"
            role="status"
            style={{
              left: tipAnchor.x,
              top: tipAnchor.y,
              transform: `translate(${tipAnchor.x > geo.width - 170 ? "calc(-100% - 14px)" : tipAnchor.x < 130 ? "14px" : "-50%"}, ${tipAnchor.y < 130 ? "16px" : "calc(-100% - 14px)"})`,
              borderTopColor: tooltipContent.accent,
            }}
          >
            <div className="ltr-tooltip-title">{tooltipContent.title}</div>
            {tooltipContent.rows.map(([k, v]) => (
              <div key={k} className="ltr-tooltip-row">
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function speedTicks(dmin: number, dmax: number): Array<{ v: number; label: string }> {
  const ticks: Array<{ v: number; label: string }> = [];
  const step = dmax - dmin > 12 ? 2 : 1;
  for (let v = Math.ceil(dmin); v <= Math.floor(dmax); v += step) {
    ticks.push({ v, label: `${v} km/h` });
  }
  return ticks;
}
