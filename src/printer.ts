import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import type { PrintPayload, PrintItem } from "./types.js";
import { config } from "./config.js";

// Tek printer instance — `node-thermal-printer` her print'te buffer'ı sıfırlar.
function buildPrinter(): ThermalPrinter {
  return new ThermalPrinter({
    type: config.printerType === "star" ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: config.printerInterface,
    characterSet: CharacterSet.WPC1254_TURKISH,
    width: config.charsPerLine,
    options: { timeout: 5000 },
  });
}

export async function isPrinterConnected(): Promise<boolean> {
  try {
    const printer = buildPrinter();
    return await printer.isPrinterConnected();
  } catch {
    return false;
  }
}

export async function printReceipt(payload: PrintPayload): Promise<void> {
  const printer = buildPrinter();

  // Bağlantı kontrolü — yazıcı kapalı / kâğıt yoksa erken hata.
  const connected = await printer.isPrinterConnected();
  if (!connected) {
    throw new Error("PRINTER_OFFLINE");
  }

  const W = config.charsPerLine;

  // ── HEADER ──────────────────────────────────────────────
  printer.alignCenter();
  printer.setTextSize(1, 1); // double width + double height
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

  await printer.execute();
}

// ─────────────────────────────────────────────────────────
// Render helpers
// ─────────────────────────────────────────────────────────

function renderItem(
  printer: ThermalPrinter,
  item: PrintItem,
  width: number
): void {
  // Item başlığı: "x2 MARGHERITA PIZZA - Büyük" (bold + double height)
  const sizeSuffix = item.size_label ? ` - ${item.size_label}` : "";
  const titleLine = `x${item.quantity}  ${item.product_name.toUpperCase()}${sizeSuffix}`;

  printer.bold(true);
  printer.setTextDoubleHeight();
  // Double height'ta width değişmiyor, ama emniyet için wrap uygula.
  for (const line of wrap(titleLine, width)) {
    printer.println(line);
  }
  printer.setTextNormal();
  printer.bold(false);

  // Customization'ları group'a göre topla — aynı gruptan multi seçim varsa
  // virgülle birleştir ("Çıkar: Soğan, Mantar").
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

  // Item notu: invert (bg/fg ters) ile vurgulanır.
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

// Naive word-wrap. İlk satır prefix-siz, devam satırları `continuationPrefix`.
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
