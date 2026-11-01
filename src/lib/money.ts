export function parseAmountToken(token: string): number | null {
  const cleaned = token.replace(/[$€£¥]/g, "").replace(/\s/g, "");
  if (!cleaned || !/^[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const lastSep = Math.max(lastComma, lastDot);

  if (lastSep === -1) {
    return parseInt(cleaned, 10) * 100;
  }

  const decimals = cleaned.slice(lastSep + 1);
  if (decimals.length > 0 && decimals.length <= 2) {
    const whole = cleaned.slice(0, lastSep).replace(/[.,]/g, "") || "0";
    const frac = decimals.padEnd(2, "0").slice(0, 2);
    return parseInt(whole, 10) * 100 + parseInt(frac, 10);
  }

  const asInteger = cleaned.replace(/[.,]/g, "");
  return parseInt(asInteger, 10) * 100;
}

export function formatMoney(
  cents: number,
  currency: string,
  locale: string,
  signed: "auto" | "never" = "never",
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    signDisplay: signed === "auto" ? "exceptZero" : "auto",
  });
  return formatter.format(cents / 100);
}

export function formatSignedMoney(
  cents: number,
  kind: "expense" | "income" | "transfer" | "refund",
  currency: string,
  locale: string,
): string {
  if (kind === "transfer") {
    return formatMoney(cents, currency, locale, "never");
  }
  const signed = kind === "expense" ? -cents : cents;
  return formatMoney(signed, currency, locale, "auto");
}
