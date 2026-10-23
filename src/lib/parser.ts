import { resolveDateHint, todayISO } from "@/lib/dates";
import { parseAmountToken } from "@/lib/money";
import { toMerchantKey } from "@/lib/utils";
import type { ParsedQuickAdd, TransactionKind } from "@/lib/types";

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

const ARROW_TOKENS = new Set(["->", "→", ">"]);
const TRANSFER_KEYWORDS = new Set(["transfer", "xfer"]);
const SKIP_WORDS = new Set(["from", "to"]);

export function parseQuickAdd(raw: string, today = todayISO()): ParsedQuickAdd {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "Need an amount" };
  }

  const tokens = expandTransferTokens(trimmed.split(/\s+/));
  const first = tokens[0]?.toLowerCase();
  const isKeywordTransfer = Boolean(first && TRANSFER_KEYWORDS.has(first));
  const hasArrow = tokens.some((token) => ARROW_TOKENS.has(token));

  if (isKeywordTransfer || hasArrow) {
    return parseTransfer(tokens, today, isKeywordTransfer);
  }

  return parseIncomeExpense(tokens, today);
}

function expandTransferTokens(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    const match = token.match(/^(.*?)(->|→|>)(.*)$/);
    if (match && (match[1] || match[3])) {
      if (match[1]) expanded.push(match[1]);
      expanded.push("->");
      if (match[3]) expanded.push(match[3]);
      continue;
    }
    expanded.push(token);
  }
  return expanded;
}

function parseIncomeExpense(tokens: string[], today: string): ParsedQuickAdd {
  let kind: TransactionKind = "expense";
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
  let accountToken: string | undefined;
  let date = today;
  const descriptionParts: string[] = [];

  for (let i = cursor; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("@") && token.length > 1) {
      categoryToken = token.slice(1);
      continue;
    }
    if (token.startsWith("#") && token.length > 1) {
      if (accountToken) {
        return { ok: false, reason: "Use -> to transfer between accounts" };
      }
      accountToken = token.slice(1);
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
    accountToken,
    date,
  };
}

function parseTransfer(tokens: string[], today: string, skipKeyword: boolean): ParsedQuickAdd {
  let cursor = skipKeyword ? 1 : 0;

  if (tokens[cursor] === "+") {
    cursor += 1;
  } else if (tokens[cursor]?.startsWith("+")) {
    tokens[cursor] = tokens[cursor].slice(1);
  }

  const amountCents = parseAmountToken(tokens[cursor] ?? "");
  if (amountCents === null || amountCents <= 0) {
    return { ok: false, reason: "Need an amount" };
  }
  cursor += 1;

  let accountToken: string | undefined;
  let toAccountToken: string | undefined;
  let date = today;
  const descriptionParts: string[] = [];

  for (let i = cursor; i < tokens.length; i += 1) {
    const token = tokens[i];
    const lower = token.toLowerCase();

    if (ARROW_TOKENS.has(token) || SKIP_WORDS.has(lower)) {
      continue;
    }
    if (token.startsWith("@") && token.length > 1) {
      continue;
    }
    if (token.startsWith("#") && token.length > 1) {
      if (!accountToken) {
        accountToken = token.slice(1);
      } else if (!toAccountToken) {
        toAccountToken = token.slice(1);
      } else {
        return { ok: false, reason: "Transfer needs two accounts" };
      }
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

  if (!accountToken || !toAccountToken) {
    return { ok: false, reason: "Transfer needs #from and #to" };
  }
  if (accountToken.toLowerCase() === toAccountToken.toLowerCase()) {
    return { ok: false, reason: "Pick two different accounts" };
  }

  const description = descriptionParts.join(" ").trim();
  return {
    ok: true,
    amountCents,
    kind: "transfer",
    description,
    merchantKey: description ? toMerchantKey(description) : "",
    accountToken,
    toAccountToken,
    date,
  };
}
