/**
 * Fritsch-Carlson monotone cubic Hermite interpolation.
 * Produces a smooth curve through the measured stages that never
 * overshoots the data (no artificial lactate values between stages).
 */
export function monotoneInterpolator(
  xsIn: number[],
  ysIn: number[],
): (x: number) => number {
  const n = xsIn.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => ysIn[0];

  const order = xsIn.map((_, i) => i).sort((a, b) => xsIn[a] - xsIn[b]);
  const xs = order.map((i) => xsIn[i]);
  const ys = order.map((i) => ysIn[i]);

  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }

  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] =
      delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }

  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h[i] * m[i + 1]
    );
  };
}

export function resampleCurve(
  xs: number[],
  ys: number[],
  steps = 160,
): Array<{ x: number; y: number }> {
  if (xs.length === 0) return [];
  const f = monotoneInterpolator(xs, ys);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    pts.push({ x, y: f(x) });
  }
  return pts;
}
