import { resolveDateHint, todayISO } from "@/lib/dates";
import { parseAmountToken } from "@/lib/money";
import { toMerchantKey } from "@/lib/utils";
import type { Category, ParsedQuickAdd, TransactionKind } from "@/lib/types";

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

export function parseQuickAdd(raw: string, today = todayISO(), categories?: Category[]): ParsedQuickAdd {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "Need an amount" };
  }

  const tokens = expandTransferTokens(trimmed.split(/\s+/));
  const first = tokens[0]?.toLowerCase();
  const isKeywordTransfer = Boolean(first && TRANSFER_KEYWORDS.has(first));
  const hasArrow = tokens.some((token) => ARROW_TOKENS.has(token));

  if (isKeywordTransfer || hasArrow) {
    return parseTransfer(tokens, today, isKeywordTransfer, categories);
  }

  return parseIncomeExpense(tokens, today, categories);
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

function isReservedToken(token: string, next: string | undefined, today: string): boolean {
  if (token.startsWith("@") || token.startsWith("#") || ARROW_TOKENS.has(token)) return true;
  if (resolveDateHint(token, today)) return true;
  return token.toLowerCase() === "last" && Boolean(next && DATE_HINT_WORDS.has(next.toLowerCase()));
}

function takeCategoryPhrase(
  tokens: string[],
  index: number,
  today: string,
  categories?: Category[],
): { phrase: string; resumeIndex: number } {
  const first = tokens[index].slice(1);
  if (!categories || categories.length === 0) return { phrase: first, resumeIndex: index + 1 };

  const names = categories.filter((category) => !category.isArchived).map((category) => category.name.toLowerCase());
  let exactEnd = names.includes(first.toLowerCase()) ? index : -1;

  for (let end = index + 1; end < tokens.length; end += 1) {
    if (isReservedToken(tokens[end], tokens[end + 1], today)) break;
    const phrase = [first, ...tokens.slice(index + 1, end + 1)].join(" ").toLowerCase();
    const exact = names.includes(phrase);
    const canGrow = names.some((name) => name.startsWith(phrase));
    if (!exact && !canGrow) break;
    if (exact) exactEnd = end;
    if (exact && !names.some((name) => name.startsWith(`${phrase} `))) break;
  }

  const end = exactEnd >= index ? exactEnd : index;
  return {
    phrase: [first, ...tokens.slice(index + 1, end + 1)].join(" "),
    resumeIndex: end + 1,
  };
}

function parseIncomeExpense(tokens: string[], today: string, categories?: Category[]): ParsedQuickAdd {
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
  const accountTokens: string[] = [];
  let date = today;
  const descriptionParts: string[] = [];

  for (let i = cursor; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("@") && token.length > 1) {
      const taken = takeCategoryPhrase(tokens, i, today, categories);
      categoryToken = taken.phrase;
      i = taken.resumeIndex - 1;
      continue;
    }
    if (token.startsWith("#") && token.length > 1) {
      accountTokens.push(token.slice(1));
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
  const [accountToken, toAccountToken, extraAccountToken] = accountTokens;
  const shorthandTransfer =
    kind === "expense" && !description && !categoryToken && accountTokens.length > 0;

  if (shorthandTransfer) {
    if (extraAccountToken) {
      return { ok: false, reason: "Transfer needs two accounts" };
    }
    if (toAccountToken && accountToken.toLowerCase() === toAccountToken.toLowerCase()) {
      return { ok: false, reason: "Pick two different accounts" };
    }
    return {
      ok: true,
      amountCents,
      kind: "transfer",
      description: "",
      merchantKey: "",
      accountToken,
      toAccountToken,
      date,
    };
  }

  if (accountTokens.length >= 2) {
    return { ok: false, reason: "Use -> to transfer between accounts" };
  }
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

function parseTransfer(tokens: string[], today: string, skipKeyword: boolean, categories?: Category[]): ParsedQuickAdd {
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
      i = takeCategoryPhrase(tokens, i, today, categories).resumeIndex - 1;
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

  if (!accountToken) {
    return { ok: false, reason: "Transfer needs #from and #to" };
  }
  if (toAccountToken && accountToken.toLowerCase() === toAccountToken.toLowerCase()) {
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
