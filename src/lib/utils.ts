import { clsx, type ClassValue } from "clsx";
import { formatDistanceToNow } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function toDate(value: any): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateSafe(
  value: any,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  fallback = "Unknown",
) {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString(undefined, options);
}

export function formatRelativeTime(value: any, fallback = "Recently") {
  const date = toDate(value);
  if (!date) return fallback;

  try {
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return fallback;
  }
}

export function getSharedDocId(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("docId") || sessionStorage.getItem("fin_shared_docId");
}

export function setSharedDocId(id: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem("fin_shared_docId", id);
  const url = new URL(window.location.href);
  url.searchParams.set("docId", id);
  window.history.replaceState({}, "", url.toString());
}

export function clearSharedDocId() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem("fin_shared_docId");
  const url = new URL(window.location.href);
  url.searchParams.delete("docId");
  window.history.replaceState({}, "", url.toString());
}

export function safeJsonParse(text: string): any {
  let cleaned = (text || "").trim();
  if (!cleaned) {
    throw new Error("Empty model response");
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    let repaired = cleaned
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
        return '"' + p1.replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
      });

    try {
      return JSON.parse(repaired);
    } catch (err2: any) {
      let openBraces = 0;
      let openBrackets = 0;
      let inString = false;
      let escape = false;
      let repairStr = repaired;

      for (let i = 0; i < repairStr.length; i++) {
        const char = repairStr[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\\") {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === "{") openBraces++;
          else if (char === "}") openBraces--;
          else if (char === "[") openBrackets++;
          else if (char === "]") openBrackets--;
        }
      }

      if (inString) {
        repairStr += '"';
      }

      while (openBrackets > 0) {
        repairStr += "]";
        openBrackets--;
      }
      while (openBraces > 0) {
        repairStr += "}";
        openBraces--;
      }

      try {
        return JSON.parse(repairStr);
      } catch (err3: any) {
        throw new Error(
          `JSON parsing failed after all repairs. Original: ${err.message}. Repaired: ${err3.message}`,
        );
      }
    }
  }
}
