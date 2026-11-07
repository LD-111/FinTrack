import type { Account, AccountType, Budget, Category, CategoryKind, Transaction, TransactionKind, ValuationLog } from "@/lib/types";
import type { ImportIssue, LedgerSnapshot } from "@/lib/excel";

const HANDOFF_PATH = "/v1/handoff";
const TOKEN = /^[0-9a-fA-F]{32}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_ROWS = 50_000;
const MAX_ID = 80;
const MAX_TEXT = 500;

const ACCOUNT_TYPES = new Set<AccountType>(["bank", "cash", "savings", "investment", "crypto", "stock"]);
const CATEGORY_KINDS = new Set<CategoryKind>(["expense", "income"]);
const TRANSACTION_KINDS = new Set<TransactionKind>(["expense", "income", "transfer", "refund"]);

export interface HandoffTarget {
  host: string;
  port: number;
  token: string;
}

export interface HandoffPreview {
  title: string;
  description?: string;
  needsConfirm: boolean;
  seedLabel: string | null;
}

type ReadResult =
  | { ok: true; snapshot: LedgerSnapshot; issues: ImportIssue[] }
  | { ok: false; reason: string };

export function handoffUrl(host: string, port: number, token: string): string {
  return `http://${host}:${port}${HANDOFF_PATH}?token=${token}`;
}

export function parseHandoffTarget(address: string, tokenField = ""): HandoffTarget | null {
  const text = address.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/" && path !== HANDOFF_PATH) return null;
  if (!url.port) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const token = (url.searchParams.get("token")?.trim() || tokenField.trim()).toLowerCase();
  if (!TOKEN.test(token) || !url.hostname) return null;
  return { host: url.hostname, port, token };
}

export function handoffSeed(host: LedgerSnapshot, guest: LedgerSnapshot): { accounts: Account[]; categories: Category[] } {
  const accountIds = new Set(guest.accounts.map((account) => account.id));
  const categoryIds = new Set(guest.categories.map((category) => category.id));
  return {
    accounts: host.accounts.filter((account) => !accountIds.has(account.id)),
    categories: host.categories.filter((category) => !categoryIds.has(category.id)),
  };
}

export function describeHandoff(input: {
  add: { accounts: number; categories: number; transactions: number; budgets: number; valuations: number };
  issueNote: string | null;
  seedAccounts: number;
  seedCategories: number;
}): HandoffPreview {
  const adding = [
    input.add.accounts ? countLabel(input.add.accounts, "account", "accounts") : null,
    input.add.categories ? countLabel(input.add.categories, "category", "categories") : null,
    input.add.transactions ? countLabel(input.add.transactions, "transaction", "transactions") : null,
    input.add.budgets ? countLabel(input.add.budgets, "budget", "budgets") : null,
    input.add.valuations ? countLabel(input.add.valuations, "valuation", "valuations") : null,
  ].filter((part): part is string => part !== null);
  const sending = [
    input.seedAccounts ? countLabel(input.seedAccounts, "account", "accounts") : null,
    input.seedCategories ? countLabel(input.seedCategories, "category", "categories") : null,
  ].filter((part): part is string => part !== null);
  const seedLabel = sending.length > 0 ? sending.join(" and ") : null;
  const needsConfirm = adding.length > 0 || seedLabel !== null || input.issueNote !== null;
  if (!needsConfirm) return { title: "Nothing new to import", needsConfirm: false, seedLabel: null };

  const description = [adding.length > 0 && seedLabel ? `Send ${seedLabel} to the phone` : null, input.issueNote]
    .filter((part): part is string => part !== null)
    .join(". ");
  const title =
    adding.length > 0
      ? `Add ${adding.join(", ")} on this computer`
      : seedLabel
        ? `Send ${seedLabel} to the phone`
        : "Review this transfer";
  return { title, description: description || undefined, needsConfirm: true, seedLabel };
}

export function readHandoffBody(input: unknown): ReadResult {
  if (!isRecord(input)) return { ok: false, reason: "Could not read this ledger" };
  const accounts = readRows(input.accounts, "Accounts", parseAccount);
  const categories = readRows(input.categories, "Categories", parseCategory);
  const transactions = readRows(input.transactions, "Transactions", parseTransaction);
  const budgets = readRows(input.budgets, "Budgets", parseBudget);
  const valuationLogs = readRows(input.valuationLogs, "Valuations", parseValuation);
  if (!accounts || !categories || !transactions || !budgets || !valuationLogs) {
    return { ok: false, reason: "Could not read this ledger" };
  }
  return {
    ok: true,
    snapshot: {
      accounts: accounts.rows,
      categories: categories.rows,
      transactions: transactions.rows,
      budgets: budgets.rows,
      valuationLogs: valuationLogs.rows,
    },
    issues: [
      ...accounts.issues,
      ...categories.issues,
      ...transactions.issues,
      ...budgets.issues,
      ...valuationLogs.issues,
    ],
  };
}

export function readHandoffResult(
  status: number,
  body: string,
): { ok: true; accounts: Account[]; categories: Category[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  const reason = reasonFrom(parsed);
  if (status !== 200) return { ok: false, reason: reason ?? reasonForStatus(status) };
  if (!isRecord(parsed) || parsed.ok !== true) {
    return { ok: false, reason: reason ?? "The computer declined the transfer" };
  }
  const accounts = readRows(parsed.accounts, "Accounts", parseAccount);
  const categories = readRows(parsed.categories, "Categories", parseCategory);
  if (!accounts || !categories) return { ok: false, reason: "The computer sent an unreadable reply" };
  return { ok: true, accounts: accounts.rows, categories: categories.rows };
}

export function emptyLedger(): LedgerSnapshot {
  return { accounts: [], categories: [], transactions: [], budgets: [], valuationLogs: [] };
}

function reasonFrom(value: unknown): string | null {
  if (!isRecord(value) || typeof value.reason !== "string") return null;
  const reason = value.reason.trim();
  return reason || null;
}

function reasonForStatus(status: number): string {
  if (status === 401) return "The code did not match. Scan the code again.";
  if (status === 408) return "The computer did not answer. Accept the transfer on the computer, or try again.";
  if (status === 409) return "The computer declined the transfer.";
  if (status === 503) return "The computer closed the session.";
  return "Could not finish the transfer. Use Export and Import if this Wi-Fi blocks device-to-device traffic.";
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRows<T>(
  value: unknown,
  sheet: string,
  parse: (value: unknown, sheet: string, row: number) => { row: T } | { issue: string } | null,
): { rows: T[]; issues: ImportIssue[] } | null {
  if (value === undefined) return { rows: [], issues: [] };
  if (!Array.isArray(value) || value.length > MAX_ROWS) return null;
  const rows: T[] = [];
  const issues: ImportIssue[] = [];
  value.forEach((item, index) => {
    const parsed = parse(item, sheet, index + 1);
    if (!parsed) return;
    if ("issue" in parsed) {
      issues.push({ sheet, row: index + 1, reason: parsed.issue });
      return;
    }
    rows.push(parsed.row);
  });
  return { rows, issues };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string {
  if (value === undefined || value === null || value === "") return "";
  return text(value, max) ?? "";
}

function integer(value: unknown, min: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

function stamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return value;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return value;
}

function parseAccount(value: unknown): { row: Account } | { issue: string } | null {
  if (!isRecord(value)) return { issue: "Need an account" };
  const id = text(value.id, MAX_ID);
  const name = text(value.name, MAX_TEXT);
  const type = typeof value.type === "string" && ACCOUNT_TYPES.has(value.type as AccountType) ? (value.type as AccountType) : null;
  const slug = optionalText(value.slug, MAX_ID);
  const openingBalanceCents = integer(value.openingBalanceCents, Number.MIN_SAFE_INTEGER);
  const createdAt = stamp(value.createdAt);
  const updatedAt = stamp(value.updatedAt);
  if (!id || !name) return { issue: "Need a name" };
  if (!type) return { issue: "Unknown account type" };
  if (openingBalanceCents === null) return { issue: "Need an amount" };
  if (typeof value.isArchived !== "boolean" || !createdAt || !updatedAt) return { issue: "Need an account" };
  return {
    row: { id, name, type, slug, openingBalanceCents, isArchived: value.isArchived, createdAt, updatedAt },
  };
}

function parseCategory(value: unknown): { row: Category } | { issue: string } | null {
  if (!isRecord(value)) return { issue: "Need a category" };
  const id = text(value.id, MAX_ID);
  const name = text(value.name, MAX_TEXT);
  const kind = typeof value.kind === "string" && CATEGORY_KINDS.has(value.kind as CategoryKind) ? (value.kind as CategoryKind) : null;
  const color = optionalText(value.color, MAX_ID);
  const icon = optionalText(value.icon, MAX_ID);
  const createdAt = stamp(value.createdAt);
  const parentId = value.parentId === null || value.parentId === undefined || value.parentId === "" ? null : text(value.parentId, MAX_ID);
  if (!id || !name) return { issue: "Need a name" };
  if (!kind) return { issue: "Unknown category" };
  if (value.parentId && parentId === null) return { issue: "Need a category" };
  if (typeof value.isArchived !== "boolean" || !createdAt) return { issue: "Need a category" };
  return {
    row: {
      id,
      name,
      kind,
      color: color || "#64748b",
      icon: icon || undefined,
      parentId,
      isArchived: value.isArchived,
      createdAt,
    },
  };
}

function parseTransaction(value: unknown): { row: Transaction } | { issue: string } | null {
  if (!isRecord(value)) return { issue: "Need a transaction" };
  const id = text(value.id, MAX_ID);
  const kind =
    typeof value.kind === "string" && TRANSACTION_KINDS.has(value.kind as TransactionKind)
      ? (value.kind as TransactionKind)
      : null;
  const amountCents = integer(value.amountCents, 0);
  const accountId = text(value.accountId, MAX_ID);
  const categoryId = text(value.categoryId, MAX_ID);
  const description = typeof value.description === "string" && value.description.length <= MAX_TEXT ? value.description : null;
  const date = isoDate(value.date);
  const createdAt = stamp(value.createdAt);
  const updatedAt = stamp(value.updatedAt);
  const toAccountId = value.toAccountId === undefined || value.toAccountId === "" ? undefined : text(value.toAccountId, MAX_ID);
  if (!id || description === null || !accountId || !categoryId) return { issue: "Need a transaction" };
  if (!kind) return { issue: "Unknown transaction" };
  if (amountCents === null) return { issue: "Need an amount" };
  if (!date) return { issue: "Need a date" };
  if ((value.toAccountId && toAccountId === null) || !createdAt || !updatedAt) return { issue: "Need a transaction" };
  const notes = optionalText(value.notes, MAX_TEXT);
  return {
    row: {
      id,
      amountCents,
      kind,
      accountId,
      toAccountId: toAccountId ?? undefined,
      description,
      merchantKey: optionalText(value.merchantKey, MAX_TEXT),
      categoryId,
      date,
      notes: notes || undefined,
      createdAt,
      updatedAt,
    },
  };
}

function parseBudget(value: unknown): { row: Budget } | { issue: string } | null {
  if (!isRecord(value)) return { issue: "Need a budget" };
  const id = text(value.id, MAX_ID);
  const categoryId = text(value.categoryId, MAX_ID);
  const amountCents = integer(value.amountCents, 0);
  const createdAt = stamp(value.createdAt);
  const updatedAt = stamp(value.updatedAt);
  if (!id || !categoryId) return { issue: "Need a budget" };
  if (value.period !== "monthly") return { issue: "Unknown budget" };
  if (amountCents === null || !createdAt || !updatedAt) return { issue: "Need an amount" };
  return { row: { id, categoryId, amountCents, period: "monthly", createdAt, updatedAt } };
}

function parseValuation(value: unknown): { row: ValuationLog } | { issue: string } | null {
  if (!isRecord(value)) return { issue: "Need a valuation" };
  const id = text(value.id, MAX_ID);
  const accountId = text(value.accountId, MAX_ID);
  const valueCents = integer(value.valueCents, 0);
  const date = isoDate(value.date);
  const createdAt = stamp(value.createdAt);
  if (!id || !accountId) return { issue: "Need a valuation" };
  if (valueCents === null) return { issue: "Need an amount" };
  if (!date || !createdAt) return { issue: "Need a date" };
  return { row: { id, accountId, valueCents, date, createdAt } };
}
