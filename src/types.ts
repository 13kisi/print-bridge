// Web admin tarafıyla shared kontratı.
// src/lib/print-receipt.ts içindeki PrintPayload ile bire bir uyumlu olmalı.

export type OrderType = "dine_in" | "take_away";

export interface PrintCustomization {
  group_label: string; // "Hamur", "Çıkar", "Ekle"
  option_label: string; // "İnce", "Soğan", "Ekstra Peynir"
  quantity: number;
}

export interface PrintItem {
  quantity: number;
  product_name: string;
  size_label: string | null;
  item_note: string | null;
  customizations: PrintCustomization[];
}

export interface PrintPayload {
  order_number: number;
  order_type: OrderType;
  table_label: string | null;
  table_area: string | null;
  general_note: string | null;
  total: number;
  created_at: string; // ISO 8601
  items: PrintItem[];
}

export type PrintResult =
  | { ok: true }
  | { ok: false; error: string };
