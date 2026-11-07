/** Money rules (contract.md §4.1): integer pence everywhere; format only at the edge. */

/** 3450 → "£34.50", 123456 → "£1,234.56". Integer maths only. */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  return `${sign}£${Math.floor(abs / 100).toLocaleString("en-GB")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Messy fare text → pence: "£34.50" → 3450, "34.5" → 3450, "1,234" → 123400, 12.3 → 1230. null when unparseable. */
export function parsePounds(input: string | number): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/^£/, "").replaceAll(",", "").trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
