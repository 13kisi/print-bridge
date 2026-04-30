import express, { type Request, type Response } from "express";
import cors from "cors";
import { config } from "./config.js";
import { printReceipt, isPrinterConnected } from "./printer.js";
import type { PrintPayload } from "./types.js";

const app = express();

// Sadece localhost'tan dinle — internet'e açma.
const HOST = "127.0.0.1";

app.use(express.json({ limit: "256kb" }));

// CORS — allowlist'e olmayan origin'i reddet.
app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin / curl / server-to-server (origin: undefined) → izin ver.
      if (!origin) return cb(null, true);
      if (config.allowedOrigins.includes(origin)) return cb(null, true);
      // Vercel preview wildcard: https://pizzapia-*.vercel.app
      if (
        origin.startsWith("https://") &&
        origin.endsWith(".vercel.app") &&
        config.allowedOrigins.some((a) => a.includes(".vercel.app"))
      ) {
        return cb(null, true);
      }
      cb(new Error(`CORS: ${origin} izinli değil`));
    },
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// ─────────────────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────────────────
app.get("/health", async (_req: Request, res: Response) => {
  const connected = await isPrinterConnected();
  if (!connected) {
    return res.status(503).json({ ok: false });
  }
  return res.json({
    ok: true,
    printer: config.printerType,
    interface: config.printerInterface,
    paperWidth: config.paperWidth,
  });
});

// ─────────────────────────────────────────────────────────
// POST /print
// ─────────────────────────────────────────────────────────
app.post("/print", async (req: Request, res: Response) => {
  const payload = validatePayload(req.body);
  if (!payload) {
    return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD" });
  }

  try {
    await printReceipt(payload);
    return res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PRINT_FAILED";
    const status = msg === "PRINTER_OFFLINE" ? 503 : 500;
    console.error("[print] hata:", msg);
    return res.status(status).json({ ok: false, error: msg });
  }
});

// ─────────────────────────────────────────────────────────
// Validation — payload temel şekil kontrolü
// ─────────────────────────────────────────────────────────
function validatePayload(body: unknown): PrintPayload | null {
  if (!body || typeof body !== "object") return null;
  const p = body as Record<string, unknown>;

  if (typeof p.order_number !== "number") return null;
  if (p.order_type !== "dine_in" && p.order_type !== "take_away") return null;
  if (typeof p.total !== "number") return null;
  if (typeof p.created_at !== "string") return null;
  if (!Array.isArray(p.items) || p.items.length === 0) return null;

  for (const it of p.items) {
    if (!it || typeof it !== "object") return null;
    const item = it as Record<string, unknown>;
    if (typeof item.quantity !== "number") return null;
    if (typeof item.product_name !== "string") return null;
    if (!Array.isArray(item.customizations)) return null;
  }

  return body as PrintPayload;
}

// ─────────────────────────────────────────────────────────
app.listen(config.port, HOST, () => {
  console.log(`[print-bridge] dinliyor: http://${HOST}:${config.port}`);
  console.log(`[print-bridge] yazıcı: ${config.printerType} @ ${config.printerInterface}`);
  console.log(`[print-bridge] kâğıt: ${config.paperWidth}mm (${config.charsPerLine} char/satır)`);
  console.log(`[print-bridge] CORS allowlist: ${config.allowedOrigins.join(", ")}`);
});
