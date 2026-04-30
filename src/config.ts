import "dotenv/config";

export interface BridgeConfig {
  port: number;
  printerType: "epson" | "star";
  printerInterface: string;
  paperWidth: 80 | 58;
  charsPerLine: number;
  allowedOrigins: string[];
}

function readEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const v = process.env[key]?.trim().toLowerCase();
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  console.warn(
    `[config] ${key}="${v}" geçersiz, izinli: ${allowed.join(", ")}. Fallback: ${fallback}`
  );
  return fallback;
}

function readInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config: BridgeConfig = {
  port: readInt("PORT", 9100),
  printerType: readEnum("PRINTER_TYPE", ["epson", "star"] as const, "epson"),
  printerInterface: process.env.PRINTER_INTERFACE?.trim() || "printer:auto",
  paperWidth: readInt("PAPER_WIDTH", 80) === 58 ? 58 : 80,
  charsPerLine: readInt("CHARS_PER_LINE", 48),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
