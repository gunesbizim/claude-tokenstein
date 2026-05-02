import Table from "cli-table3";

export function renderTable(headers: string[], rows: (string | number)[][]): string {
  const t = new Table({ head: headers, style: { head: [], border: [] } });
  for (const r of rows) t.push(r as string[]);
  return t.toString();
}

const SPARK = "▁▂▃▄▅▆▇█";

export function renderSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return (SPARK[3] ?? "▄").repeat(values.length);
  return values
    .map((v) => SPARK[Math.round(((v - min) / (max - min)) * 7)] ?? "▄")
    .join("");
}

export function formatCurrency(n: number, currency: "usd" | "eur"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

export function formatTokens(n: number | bigint): string {
  const num = typeof n === "bigint" ? Number(n) : n;
  return new Intl.NumberFormat(undefined).format(num);
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}
