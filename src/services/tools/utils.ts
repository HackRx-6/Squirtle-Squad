import { AppConfigService } from "../../config";

/**
 * Utility functions for tool operations
 */

export const previewString = (value: unknown, maxLen = 400): string => {
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
  } catch {
    return "<unserializable>";
  }
};

export const assertSafeUrl = (url: string): void => {
  const qa = AppConfigService.getInstance().getQAConfig();
  const denied = qa.toolCalls?.advanced?.deniedDomains || [];
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (denied.some((d: string) => host === d || host.endsWith(`.${d}`))) {
      throw new Error("Denied host");
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error("Invalid scheme");
  } catch (e) {
    throw new Error(`Unsafe URL: ${url}`);
  }
};

export const getDeep = (obj: any, path: string): any => {
  try {
    return path
      .split(".")
      .reduce((acc, key) => (acc ? acc[key] : undefined), obj);
  } catch {
    return undefined;
  }
};

// Heuristics: check city in common keys or anywhere in stringified JSON if keys not provided
export const doesBodyMatchCity = (
  body: any,
  cityLower: string,
  matchKeys?: string[]
): boolean => {
  if (!body || !cityLower) return false;
  const keys =
    matchKeys && matchKeys.length > 0
      ? matchKeys
      : ["city", "ticket.city", "result.city", "data.city", "metadata.city"];
  for (const key of keys) {
    const val = getDeep(body, key);
    if (typeof val === "string" && val.toLowerCase().includes(cityLower)) {
      return true;
    }
  }
  // Fallback: search in full JSON text if small
  try {
    const s = JSON.stringify(body).toLowerCase();
    if (s.length <= 50000 && s.includes(cityLower)) return true;
  } catch {}
  return false;
};

export const extractFlightNumber = (body: any): string | number | null => {
  if (!body) return null;
  const candidates = [
    getDeep(body, "flightNumber"),
    getDeep(body, "flight_number"),
    getDeep(body, "result.flightNumber"),
    getDeep(body, "data.flightNumber"),
    getDeep(body, "ticket.flightNumber"),
    getDeep(body, "ticket.flight_number"),
  ];
  for (const c of candidates) {
    if (typeof c === "string" || typeof c === "number") return c;
  }
  return null;
};
