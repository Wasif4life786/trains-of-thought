import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// packages/rail/src → repo root is three levels up.
const RAW_DIR = fileURLToPath(new URL("../../../data/raw/rail/", import.meta.url));

/** Reads a raw input file from data/raw/rail, exactly as collected. */
export const readRaw = (file: string): string => readFileSync(RAW_DIR + file, "utf8");

/** FNV-1a: a stable pseudo-random number per string, so generated fares and sell-outs never change between runs. */
export function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Minimal CSV reader: quoted fields, doubled quotes, CRLF. A blank line comes back as [""] so callers can count it. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Adds `n` to a counter map, e.g. fixed["duplicate"]. */
export function bump(counts: Record<string, number>, reason: string, n = 1): void {
  counts[reason] = (counts[reason] ?? 0) + n;
}
