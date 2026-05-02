/**
 * Parse values from Supabase / PostgREST (numeric often arrives as string; FR locales may use comma decimals).
 */
export function parseSupabaseNumeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return 0;
  if (typeof value === "bigint") return Number(value);

  const raw = String(value).trim();
  if (!raw) return 0;

  const normalized = raw.replace(/\s/g, "").replace(/'/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");

  let numStr = normalized;
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      numStr = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      numStr = normalized.replace(/,/g, "");
    }
  } else {
    numStr = normalized.replace(",", ".");
  }

  const n = Number(numStr);
  return Number.isFinite(n) ? n : 0;
}
