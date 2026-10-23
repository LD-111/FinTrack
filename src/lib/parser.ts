import { resolveDateHint, todayISO } from "@/lib/dates";
import { parseAmountToken } from "@/lib/money";
import { toMerchantKey } from "@/lib/utils";
import type { ParsedQuickAdd } from "@/lib/types";

const DATE_HINT_WORDS = new Set([
  "today",
  "yesterday",
  "tomorrow",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

export function parseQuickAdd(raw: string, today = todayISO()): ParsedQuickAdd {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "Need an amount" };
  }

  const tokens = trimmed.split(/\s+/);
  let kind: "expense" | "income" = "expense";
  let cursor = 0;

  if (tokens[0] === "+") {
    kind = "income";
    cursor = 1;
  } else if (tokens[0]?.startsWith("+")) {
    kind = "income";
    tokens[0] = tokens[0].slice(1);
  }

  const amountToken = tokens[cursor];
  if (!amountToken) {
    return { ok: false, reason: "Need an amount" };
  }

  const amountCents = parseAmountToken(amountToken);
  if (amountCents === null || amountCents <= 0) {
    return { ok: false, reason: "Need an amount" };
  }
  cursor += 1;

  let categoryToken: string | undefined;
  let date = today;
  const descriptionParts: string[] = [];

  for (let i = cursor; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("@") && token.length > 1) {
      categoryToken = token.slice(1);
      continue;
    }

    const next = tokens[i + 1];
    if (token.toLowerCase() === "last" && next && DATE_HINT_WORDS.has(next.toLowerCase())) {
      const hinted = resolveDateHint(`${token} ${next}`, today);
      if (hinted) {
        date = hinted;
        i += 1;
        continue;
      }
    }

    const hinted = resolveDateHint(token, today);
    if (hinted) {
      date = hinted;
      continue;
    }

    descriptionParts.push(token);
  }

  const description = descriptionParts.join(" ").trim();
  if (!description) {
    return { ok: false, reason: "Add a description" };
  }

  return {
    ok: true,
    amountCents,
    kind,
    description,
    merchantKey: toMerchantKey(description),
    categoryToken,
    date,
  };
}
