/** Money is whole cents inside; "12.50" at the edges. One currency, always shown with a plain $. */

const PLAIN = /^\d{1,12}(?:\.\d{1,2})?$/;

/**
 * Cents from what a person typed: "12.50", "12,50", "$ 1 250". Null when it isn't an amount.
 * Negative amounts are never valid: the transaction's type says which way money went.
 */
export function parseCents(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? parseCents(String(input)) : null;
  if (typeof input !== "string") return null;
  const text = input.replace(/\s/g, "").replace(/^\$/, "").replace(",", ".");
  if (!PLAIN.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "1234.50": two decimals, no symbol or separators, "-" when negative. For MCP and form values. */
export function plain(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "$1,234.50", with a true minus sign when negative. */
export function money(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "−" : ""}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** On a transaction: "−$5.00" for an expense, "+$5.00" for income. */
export function signedMoney(cents: number, type: "expense" | "income"): string {
  return `${type === "income" ? "+" : "−"}${money(Math.abs(cents))}`;
}

/** Round half to even, as the Python version's Decimal rounding did. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}
