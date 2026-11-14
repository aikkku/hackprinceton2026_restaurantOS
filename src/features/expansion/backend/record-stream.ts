import { createReadStream } from "node:fs";

const MAX_RECORD_BYTES = 8 * 1024 * 1024;

/** Bounded record reader. JSON inputs must be a top-level array of objects. */
export async function* streamRecords(path: string): AsyncGenerator<unknown> {
  const chunks = createReadStream(path, { encoding: "utf8", highWaterMark: 64 * 1024 });
  if (/\.jsonl$/i.test(path)) {
    let pending = "";
    for await (const chunk of chunks) {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line.length > MAX_RECORD_BYTES) throw new Error("Record exceeds import limit");
        if (line) { try { yield JSON.parse(line); } catch { yield null; } }
      }
      if (pending.length > MAX_RECORD_BYTES) throw new Error("Record exceeds import limit");
    }
    if (pending.trim()) { try { yield JSON.parse(pending); } catch { yield null; } }
    return;
  }
  if (/\.csv$/i.test(path)) {
    let field = "", row: string[] = [], header: string[] | null = null;
    let quoted = false, afterQuote = false, previousCR = false, size = 0;
    function finishRow(): Record<string, string> | null {
      row.push(field); field = ""; size = 0;
      if (!header) { header = row.map((s) => s.replace(/^\uFEFF/, "")); row = []; return null; }
      const result = Object.fromEntries(header.map((key, i) => [key, row[i] ?? ""]));
      const empty = row.every((x) => !x); row = []; return empty ? null : result;
    }
    for await (const chunk of chunks) for (const ch of chunk) {
      if (++size > MAX_RECORD_BYTES) throw new Error("Record exceeds import limit");
      if (previousCR) { previousCR = false; if (ch === "\n") continue; }
      if (quoted) {
        if (ch === '"') { quoted = false; afterQuote = true; } else field += ch;
      } else if (afterQuote && ch === '"') { field += '"'; quoted = true; afterQuote = false; }
      else if (ch === ",") { row.push(field); field = ""; afterQuote = false; }
      else if (ch === "\n" || ch === "\r") {
        const result = finishRow(); afterQuote = false; previousCR = ch === "\r";
        if (result) yield result;
      } else if (ch === '"' && !field) { quoted = true; afterQuote = false; }
      else { if (afterQuote && ch.trim()) throw new Error("Invalid CSV quote"); field += ch; }
    }
    if (quoted) throw new Error("Unterminated CSV record");
    if (field || row.length) { const result = finishRow(); if (result) yield result; }
    return;
  }
  if (!/\.json$/i.test(path)) throw new Error("Unsupported import format");
  let started = false, ended = false, buffer = "", depth = 0, quoted = false, escaped = false, needComma = false, afterComma = false;
  for await (const chunk of chunks) for (const ch of chunk) {
    if (!started) { if (!ch.trim() || ch === "\uFEFF") continue; if (ch !== "[") throw new Error("JSON must be an array"); started = true; continue; }
    if (ended) { if (ch.trim()) throw new Error("Trailing JSON data"); continue; }
    if (!depth) {
      if (!ch.trim()) continue;
      if (ch === "]") { if (afterComma) throw new Error("Trailing JSON comma"); ended = true; continue; }
      if (ch === "," && needComma) { needComma = false; afterComma = true; continue; }
      if (ch !== "{" || needComma) throw new Error("Expected JSON object");
      buffer = "{"; depth = 1; afterComma = false; continue;
    }
    buffer += ch;
    if (buffer.length > MAX_RECORD_BYTES) throw new Error("Record exceeds import limit");
    if (quoted) {
      if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    if (!depth) { yield JSON.parse(buffer); buffer = ""; needComma = true; }
  }
  if (!started || !ended || depth) throw new Error("Incomplete JSON array");
}
