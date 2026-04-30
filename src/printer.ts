import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import { spawn } from "child_process";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as net from "net";
import type { PrintPayload, PrintItem } from "./types.js";
import { config } from "./config.js";

// `node-thermal-printer`'ı sadece ESC/POS buffer üretmek için kullanıyoruz;
// transport (yazıcıya gerçek byte gönderimi) bizim sendBuffer() içinde.
// Sebep: kütüphanenin `printer:NAME` interface'i Windows USB için native
// modül (@thiagoelg/node-printer) gerektiriyor — bu modül node-gyp ile
// derleniyor, Python + VS Build Tools istiyor. Onun yerine PowerShell +
// Windows winspool.drv ile direkt RAW print yapıyoruz: native derleme yok.
function buildPrinter(): ThermalPrinter {
  return new ThermalPrinter({
    type: config.printerType === "star" ? PrinterTypes.STAR : PrinterTypes.EPSON,
    // Dummy TCP interface — sadece constructor'ı tatmin ediyor; execute()
    // hiç çağrılmadığı için bu adres asla kullanılmıyor. "tcp://" prefix'i
    // önemli: kütüphane bunu görünce native printer modülünü `require`
    // etmiyor → install hatası tetiklenmiyor.
    interface: "tcp://127.0.0.1:1",
    characterSet: CharacterSet.WPC1254_TURKISH,
    width: config.charsPerLine,
  });
}

export async function isPrinterConnected(): Promise<boolean> {
  const target = config.printerInterface;
  if (target.startsWith("tcp://")) {
    return checkTcpReachable(target);
  }
  return checkWindowsPrinter(parsePrinterName(target));
}

export async function printReceipt(payload: PrintPayload): Promise<void> {
  const printer = buildPrinter();
  const W = config.charsPerLine;

  // ── HEADER ──────────────────────────────────────────────
  printer.alignCenter();
  printer.setTextSize(1, 1);
  printer.bold(true);
  printer.println("PIZZA PIA");
  printer.setTextNormal();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(`ADISYON #${String(payload.order_number).padStart(3, "0")}`);
  printer.setTextNormal();
  printer.bold(false);
  printer.drawLine();

  // ── META ───────────────────────────────────────────────
  printer.alignLeft();
  printer.println(`Tarih:  ${formatDate(payload.created_at)}`);
  printer.println(`Tip:    ${formatTypeLine(payload)}`);
  printer.drawLine();
  printer.newLine();

  // ── ITEMS ──────────────────────────────────────────────
  for (const item of payload.items) {
    renderItem(printer, item, W);
    printer.newLine();
  }

  // ── GENERAL NOTE ───────────────────────────────────────
  if (payload.general_note?.trim()) {
    printer.drawLine();
    printer.bold(true);
    printer.println("NOT (genel):");
    printer.bold(false);
    for (const line of wrap(payload.general_note.trim(), W)) {
      printer.println(line);
    }
  }

  // ── TOTAL ──────────────────────────────────────────────
  printer.drawLine();
  printer.alignRight();
  printer.bold(true);
  printer.setTextDoubleWidth();
  printer.println(`TOPLAM: ${formatMoney(payload.total)} TL`);
  printer.setTextNormal();
  printer.bold(false);
  printer.alignLeft();

  // ── FOOTER ─────────────────────────────────────────────
  printer.drawLine();
  printer.alignCenter();
  printer.println(`${formatTime(payload.created_at)} - Pizza Pia Adisyon`);
  printer.alignLeft();

  printer.newLine();
  printer.newLine();
  printer.cut();

  // Buffer'ı al, transport'a gönder.
  const buffer = printer.getBuffer();
  await sendBuffer(buffer);
}

// ─────────────────────────────────────────────────────────
// Transport — TCP (Ethernet/Wi-Fi) veya Windows raw print (USB)
// ─────────────────────────────────────────────────────────

async function sendBuffer(buffer: Buffer): Promise<void> {
  const target = config.printerInterface;
  if (target.startsWith("tcp://")) {
    await sendOverTcp(buffer, target);
  } else {
    await sendToWindowsPrinter(buffer, parsePrinterName(target));
  }
}

function parsePrinterName(iface: string): string {
  return iface.replace(/^printer:/, "").trim();
}

async function sendOverTcp(buffer: Buffer, iface: string): Promise<void> {
  const url = new URL(iface);
  const host = url.hostname;
  const port = parseInt(url.port, 10) || 9100;

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(5000);
    socket.on("error", () => finish(new Error("PRINTER_OFFLINE")));
    socket.on("timeout", () => finish(new Error("PRINTER_OFFLINE")));
    socket.connect(port, host, () => {
      socket.write(buffer, () => {
        socket.end();
        finish();
      });
    });
  });
}

async function sendToWindowsPrinter(buffer: Buffer, printerName: string): Promise<void> {
  let actualName = printerName;
  if (!actualName || actualName === "auto") {
    actualName = await getDefaultWindowsPrinter();
    if (!actualName) throw new Error("PRINTER_OFFLINE");
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "pp-bridge-"));
  const tmpFile = join(tmpDir, "receipt.bin");
  try {
    await writeFile(tmpFile, buffer);
    const scriptPath = join(__dirname, "raw-print.ps1");
    await runPowerShellFile(scriptPath, [
      "-FilePath", tmpFile,
      "-PrinterName", actualName,
    ]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runPowerShellFile(scriptPath: string, scriptArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", scriptPath,
        ...scriptArgs,
      ],
      { windowsHide: true }
    );

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("PRINTER_TIMEOUT"));
    }, 10000);

    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`PRINT_FAILED: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function runPowerShellCommand(command: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("PS_TIMEOUT"));
    }, timeoutMs);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PS exit ${code}`));
    });
  });
}

async function getDefaultWindowsPrinter(): Promise<string> {
  const cmd =
    "(Get-CimInstance -Class Win32_Printer | Where-Object Default -EQ $true | Select-Object -First 1 -ExpandProperty Name)";
  return runPowerShellCommand(cmd).catch(() => "");
}

async function checkWindowsPrinter(name: string): Promise<boolean> {
  if (!name || name === "auto") {
    const def = await getDefaultWindowsPrinter();
    return Boolean(def);
  }
  const safe = name.replace(/'/g, "''");
  const cmd = `if (Get-CimInstance -Class Win32_Printer -Filter "Name = '${safe}'") { 'true' } else { 'false' }`;
  const out = await runPowerShellCommand(cmd).catch(() => "false");
  return out.toLowerCase() === "true";
}

function checkTcpReachable(iface: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(iface);
      const port = parseInt(url.port, 10) || 9100;
      const socket = new net.Socket();
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(2000);
      socket.on("error", () => finish(false));
      socket.on("timeout", () => finish(false));
      socket.connect(port, url.hostname, () => finish(true));
    } catch {
      resolve(false);
    }
  });
}

// ─────────────────────────────────────────────────────────
// Render helpers
// ─────────────────────────────────────────────────────────

function renderItem(
  printer: ThermalPrinter,
  item: PrintItem,
  width: number
): void {
  const sizeSuffix = item.size_label ? ` - ${item.size_label}` : "";
  const titleLine = `x${item.quantity}  ${item.product_name.toUpperCase()}${sizeSuffix}`;

  printer.bold(true);
  printer.setTextDoubleHeight();
  for (const line of wrap(titleLine, width)) {
    printer.println(line);
  }
  printer.setTextNormal();
  printer.bold(false);

  const grouped = new Map<string, string[]>();
  for (const c of item.customizations) {
    const arr = grouped.get(c.group_label) ?? [];
    const label = c.quantity > 1 ? `${c.option_label} x${c.quantity}` : c.option_label;
    arr.push(label);
    grouped.set(c.group_label, arr);
  }

  for (const [group, options] of grouped) {
    const groupLabel = padRight(group, 10);
    const optionStr = options.join(", ");
    const fullLine = `    ${groupLabel}: ${optionStr}`;
    for (const line of wrap(fullLine, width, "      ")) {
      printer.println(line);
    }
  }

  if (item.item_note?.trim()) {
    printer.bold(true);
    printer.invert(true);
    for (const line of wrap(`>> ${item.item_note.trim()}`, width, "   ")) {
      printer.println(line);
    }
    printer.invert(false);
    printer.bold(false);
  }
}

// ─────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

function formatMoney(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function formatTypeLine(p: PrintPayload): string {
  if (p.order_type === "dine_in") {
    const tableTxt = p.table_label ?? "Masa";
    return `MASADA  -  ${tableTxt}`;
  }
  return "PAKET";
}

function padRight(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function wrap(text: string, width: number, continuationPrefix = ""): string[] {
  if (text.length <= width) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  let isFirst = true;
  for (const word of words) {
    const prefix = isFirst ? "" : continuationPrefix;
    const candidate = current ? `${current} ${word}` : `${prefix}${word}`;
    if (candidate.length > width && current) {
      lines.push(current);
      current = `${continuationPrefix}${word}`;
      isFirst = false;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
