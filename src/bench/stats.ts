// Rates with 95% Wilson intervals. Small samples get honest error bars.
export function wilson(k: number, n: number, z = 1.96) {
  if (n === 0) return { rate: 0, lo: 0, hi: 0 };
  const p = k / n, d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export const readJsonl = <T>(text: string): T[] =>
  text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
