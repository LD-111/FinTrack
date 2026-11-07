import * as XLSX from "xlsx";
import { uniqueAccountSlug, toAccountSlug } from "@/lib/accounts";
import { kindForMoneyIn } from "@/lib/categorizer";
import { toISODate, todayISO } from "@/lib/dates";
import { parseAmountToken } from "@/lib/money";
import {
  TRANSFER_CATEGORY_ID,
  UNCATEGORIZED_ID,
  type Account,
  type AccountType,
  type Budget,
  type BudgetPeriod,
  type Category,
  type CategoryKind,
  type Transaction,
  type TransactionKind,
  type ValuationLog,
} from "@/lib/types";
import { newId, nowIso, toMerchantKey } from "@/lib/utils";

const SHEET_NAMES = ["Accounts", "Categories", "Transactions", "Budgets", "Valuations"] as const;

const ACCOUNT_HEADERS = ["id", "name", "type", "slug", "openingBalance", "archived"] as const;
const CATEGORY_HEADERS = ["id", "name", "kind", "color", "icon", "parentId", "archived"] as const;
const TRANSACTION_HEADERS = [
  "id",
  "date",
  "kind",
  "amount",
  "description",
  "accountId",
  "account",
  "toAccountId",
  "toAccount",
  "categoryId",
  "category",
  "notes",
  "merchantKey",
] as const;
const BUDGET_HEADERS = ["id", "categoryId", "category", "amount", "period"] as const;
const VALUATION_HEADERS = ["id", "accountId", "account", "date", "value"] as const;

const ACCOUNT_TYPES = new Set<AccountType>(["bank", "cash", "savings", "investment", "crypto", "stock"]);
const CATEGORY_KINDS = new Set<CategoryKind>(["expense", "income"]);
const TRANSACTION_KINDS = new Set<TransactionKind>(["expense", "income", "transfer", "refund"]);
const DEFAULT_CATEGORY_COLOR = "#64748b";
const WORKBOOK_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface LedgerSnapshot {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  valuationLogs: ValuationLog[];
}

export interface ImportIssue {
  sheet: string;
  row: number;
  reason: string;
}

export interface ImportSkipCounts {
  accounts: number;
  categories: number;
  transactions: number;
  budgets: number;
  valuations: number;
}

export interface ImportPlan {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  valuationLogs: ValuationLog[];
  skipped: ImportSkipCounts;
  issues: ImportIssue[];
}

interface ParsedAccount {
  row: number;
  id: string;
  name: string;
  type: AccountType;
  slug: string;
  openingBalanceCents: number;
  isArchived: boolean;
}

interface ParsedCategory {
  row: number;
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  parentId: string;
  isArchived: boolean;
}

interface ParsedTransaction {
  row: number;
  id: string;
  date: string;
  kind: TransactionKind;
  amountCents: number;
  description: string;
  accountId: string;
  account: string;
  toAccountId: string;
  toAccount: string;
  categoryId: string;
  category: string;
  notes: string;
  merchantKey: string;
}

interface ParsedBudget {
  row: number;
  id: string;
  categoryId: string;
  category: string;
  amountCents: number;
  period: BudgetPeriod;
}

interface ParsedValuation {
  row: number;
  id: string;
  accountId: string;
  account: string;
  date: string;
  valueCents: number;
}

interface ParsedWorkbook {
  accounts: ParsedAccount[];
  categories: ParsedCategory[];
  transactions: ParsedTransaction[];
  budgets: ParsedBudget[];
  valuations: ParsedValuation[];
  issues: ImportIssue[];
}

export function downloadWorkbook(ledger: LedgerSnapshot): void {
  const bytes = buildWorkbook(ledger);
  const blob = new Blob([bytes], { type: WORKBOOK_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fintrack-${todayISO()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildWorkbook(ledger: LedgerSnapshot): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const accountName = indexById(ledger.accounts);
  const categoryName = indexById(ledger.categories);

  appendSheet(
    workbook,
    "Accounts",
    ACCOUNT_HEADERS,
    [...ledger.accounts]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        slug: account.slug,
        openingBalance: centsToDecimal(account.openingBalanceCents),
        archived: yesNo(account.isArchived),
      })),
    ["openingBalance"],
  );

  appendSheet(
    workbook,
    "Categories",
    CATEGORY_HEADERS,
    [...ledger.categories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => ({
        id: category.id,
        name: category.name,
        kind: category.kind,
        color: category.color,
        icon: category.icon ?? "",
        parentId: category.parentId ?? "",
        archived: yesNo(category.isArchived),
      })),
  );

  appendSheet(
    workbook,
    "Transactions",
    TRANSACTION_HEADERS,
    [...ledger.transactions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((transaction) => ({
        id: transaction.id,
        date: transaction.date,
        kind: transaction.kind,
        amount: centsToDecimal(transaction.amountCents),
        description: transaction.description,
        accountId: transaction.accountId,
        account: accountName.get(transaction.accountId) ?? "",
        toAccountId: transaction.toAccountId ?? "",
        toAccount: transaction.toAccountId ? (accountName.get(transaction.toAccountId) ?? "") : "",
        categoryId: transaction.categoryId,
        category: categoryName.get(transaction.categoryId) ?? "",
        notes: transaction.notes ?? "",
        merchantKey: transaction.merchantKey,
      })),
    ["amount"],
  );

  appendSheet(
    workbook,
    "Budgets",
    BUDGET_HEADERS,
    [...ledger.budgets]
      .sort((a, b) => (categoryName.get(a.categoryId) ?? "").localeCompare(categoryName.get(b.categoryId) ?? ""))
      .map((budget) => ({
        id: budget.id,
        categoryId: budget.categoryId,
        category: categoryName.get(budget.categoryId) ?? "",
        amount: centsToDecimal(budget.amountCents),
        period: budget.period,
      })),
    ["amount"],
  );

  appendSheet(
    workbook,
    "Valuations",
    VALUATION_HEADERS,
    [...ledger.valuationLogs]
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((log) => ({
        id: log.id,
        accountId: log.accountId,
        account: accountName.get(log.accountId) ?? "",
        date: log.date,
        value: centsToDecimal(log.valueCents),
      })),
    ["value"],
  );

  const written = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  const view = written instanceof Uint8Array ? written : new Uint8Array(written);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

export function planWorkbookImport(data: ArrayBuffer, ledger: LedgerSnapshot, defaultAccountId: string): ImportPlan {
  return planImport(parseWorkbook(data), ledger, defaultAccountId);
}

export function planSessionImport(
  incoming: LedgerSnapshot,
  ledger: LedgerSnapshot,
  defaultAccountId: string,
): ImportPlan {
  return planImport(snapshotToParsed(incoming), ledger, defaultAccountId);
}

export function summarizeImport(plan: ImportPlan): { title: string; description?: string } {
  const added = [
    countLabel(plan.accounts.length, "account", "accounts"),
    countLabel(plan.categories.length, "category", "categories"),
    countLabel(plan.transactions.length, "transaction", "transactions"),
    countLabel(plan.budgets.length, "budget", "budgets"),
    countLabel(plan.valuationLogs.length, "valuation", "valuations"),
  ].filter((part): part is string => part !== null);

  const skipped =
    plan.skipped.accounts +
    plan.skipped.categories +
    plan.skipped.transactions +
    plan.skipped.budgets +
    plan.skipped.valuations;

  const fileIssue = plan.issues.find((issue) => issue.row === 0);
  if (added.length === 0 && skipped === 0 && fileIssue && plan.issues.length === 1) {
    return { title: "Import failed", description: fileIssue.reason };
  }

  const details: string[] = [];
  if (skipped > 0) details.push(`Skipped ${skipped} existing`);
  if (plan.issues.length > 0) {
    const first = plan.issues[0];
    const where = first.row > 0 ? `${first.sheet} row ${first.row}: ${first.reason}` : first.reason;
    details.push(plan.issues.length === 1 ? where : `${where} (${plan.issues.length} invalid)`);
  }

  if (added.length === 0) {
    return { title: "Nothing new to import", description: details.join(". ") || undefined };
  }

  return { title: `Imported ${added.join(", ")}`, description: details.join(". ") || undefined };
}

function planImport(parsed: ParsedWorkbook, ledger: LedgerSnapshot, defaultAccountId: string): ImportPlan {
  const stamp = nowIso();
  const accounts = ledger.accounts.slice();
  const categories = ledger.categories.slice();
  const accountAliases = new Map<string, string>();
  const categoryAliases = new Map<string, string>();
  const transactionIds = new Set(ledger.transactions.map((transaction) => transaction.id));
  const budgetIds = new Set(ledger.budgets.map((budget) => budget.id));
  const valuationIds = new Set(ledger.valuationLogs.map((log) => log.id));
  const budgetCategoryIds = new Set(ledger.budgets.map((budget) => budget.categoryId));
  const skipped: ImportSkipCounts = { accounts: 0, categories: 0, transactions: 0, budgets: 0, valuations: 0 };
  const issues = parsed.issues.slice();
  const newAccounts: Account[] = [];
  const newCategories: Category[] = [];
  const newTransactions: Transaction[] = [];
  const newBudgets: Budget[] = [];
  const newValuations: ValuationLog[] = [];

  const accountById = (id: string): Account | undefined => {
    if (!id) return undefined;
    const aliased = accountAliases.get(id);
    return accounts.find((account) => account.id === (aliased ?? id));
  };

  const categoryById = (id: string): Category | undefined => {
    if (!id) return undefined;
    const aliased = categoryAliases.get(id);
    return categories.find((category) => category.id === (aliased ?? id));
  };

  const findAccount = (id: string, name: string): Account | undefined => {
    const byId = accountById(id);
    if (byId) return byId;
    const needle = name.trim().toLowerCase();
    if (!needle) return undefined;
    const slug = toAccountSlug(name);
    return accounts.find(
      (account) => account.name.toLowerCase() === needle || account.slug === needle || (slug !== "" && account.slug === slug),
    );
  };

  const findCategory = (id: string, name: string): Category | undefined => {
    const byId = categoryById(id);
    if (byId) return byId;
    const needle = name.trim().toLowerCase();
    if (!needle) return undefined;
    return categories.find((category) => category.name.toLowerCase() === needle);
  };

  const createAccount = (input: {
    id: string;
    name: string;
    type: AccountType;
    slug: string;
    openingBalanceCents: number;
    isArchived: boolean;
  }): Account => {
    const name = input.name.trim();
    const requestedId = input.id.trim();
    const id = requestedId && !accounts.some((account) => account.id === requestedId) ? requestedId : newId();
    const requestedSlug = input.slug.trim();
    const slug =
      requestedSlug && !accounts.some((account) => account.slug === requestedSlug)
        ? requestedSlug
        : uniqueAccountSlug(name, accounts);
    const account: Account = {
      id,
      name,
      type: input.type,
      slug,
      openingBalanceCents: input.openingBalanceCents,
      isArchived: input.isArchived,
      createdAt: stamp,
      updatedAt: stamp,
    };
    accounts.push(account);
    newAccounts.push(account);
    return account;
  };

  const createCategory = (input: {
    id: string;
    name: string;
    kind: CategoryKind;
    color: string;
    icon: string;
    parentId: string | null;
    isArchived: boolean;
  }): Category => {
    const name = input.name.trim();
    const requestedId = input.id.trim();
    const id = requestedId && !categories.some((category) => category.id === requestedId) ? requestedId : newId();
    const category: Category = {
      id,
      name,
      kind: input.kind,
      color: input.color.trim() || DEFAULT_CATEGORY_COLOR,
      icon: input.icon.trim() || undefined,
      parentId: input.parentId,
      isArchived: input.isArchived,
      createdAt: stamp,
    };
    categories.push(category);
    newCategories.push(category);
    return category;
  };

  const ensureFallbackCategory = (id: string, name: string, archived: boolean, color: string, icon: string): Category => {
    const existing = categoryById(id) ?? categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    return createCategory({
      id,
      name,
      kind: "expense",
      color,
      icon,
      parentId: null,
      isArchived: archived,
    });
  };

  const resolveAccount = (id: string, name: string): Account | null => {
    const existing = findAccount(id, name);
    if (existing) return existing;
    const label = name.trim() || id.trim();
    if (!label) return null;
    return createAccount({
      id,
      name: label,
      type: "bank",
      slug: "",
      openingBalanceCents: 0,
      isArchived: false,
    });
  };

  const resolveCategory = (id: string, name: string, kind: CategoryKind): Category | null => {
    const existing = findCategory(id, name);
    if (existing) return existing;
    const label = name.trim() || id.trim();
    if (!label) return null;
    return createCategory({
      id,
      name: label,
      kind,
      color: DEFAULT_CATEGORY_COLOR,
      icon: "",
      parentId: null,
      isArchived: false,
    });
  };

  const accountOrDefault = (id: string, name: string, sheet: string, row: number): Account | null => {
    if (!id.trim() && !name.trim()) {
      const fallback = accountById(defaultAccountId);
      if (!fallback) {
        issues.push({ sheet, row, reason: "Add an account first" });
        return null;
      }
      return fallback;
    }
    return resolveAccount(id, name);
  };

  for (const row of parsed.categories) {
    const byId = row.id ? categoryById(row.id) : undefined;
    const existing = byId ?? findCategory("", row.name);
    if (existing) {
      if (row.id && existing.id !== row.id) categoryAliases.set(row.id, existing.id);
      skipped.categories += 1;
      continue;
    }
    createCategory({
      id: row.id,
      name: row.name,
      kind: row.kind,
      color: row.color,
      icon: row.icon,
      parentId: row.parentId || null,
      isArchived: row.isArchived,
    });
  }

  for (const category of newCategories) {
    if (!category.parentId) continue;
    const parent = categoryById(category.parentId);
    category.parentId = parent && parent.id !== category.id ? parent.id : null;
  }

  for (const row of parsed.accounts) {
    const byId = row.id ? accountById(row.id) : undefined;
    const existing = byId ?? findAccount("", row.name);
    if (existing) {
      if (row.id && existing.id !== row.id) accountAliases.set(row.id, existing.id);
      skipped.accounts += 1;
      continue;
    }
    createAccount(row);
  }

  for (const row of parsed.transactions) {
    if (row.id && transactionIds.has(row.id)) {
      skipped.transactions += 1;
      continue;
    }

    const accountIsDefault = !row.accountId.trim() && !row.account.trim();
    const account = accountIsDefault ? accountById(defaultAccountId) : findAccount(row.accountId, row.account);
    if (accountIsDefault && !account) {
      issues.push({ sheet: "Transactions", row: row.row, reason: "Add an account first" });
      continue;
    }

    const destinationIsEmpty = !row.toAccountId.trim() && !row.toAccount.trim();
    const destination = destinationIsEmpty ? undefined : findAccount(row.toAccountId, row.toAccount);
    if (row.kind === "transfer" && destinationIsEmpty) {
      issues.push({ sheet: "Transactions", row: row.row, reason: "Transfer needs two accounts" });
      continue;
    }
    if (row.kind === "transfer" && sameAccountRef(account, row.accountId, row.account, destination, row.toAccountId, row.toAccount)) {
      issues.push({ sheet: "Transactions", row: row.row, reason: "Pick two different accounts" });
      continue;
    }

    const categoryIsEmpty = !row.categoryId.trim() && !row.category.trim();
    const category = categoryIsEmpty ? undefined : findCategory(row.categoryId, row.category);
    const id = row.id || newId();
    if (transactionIds.has(id)) {
      skipped.transactions += 1;
      continue;
    }

    const resolvedAccount = account ?? resolveAccount(row.accountId, row.account);
    if (!resolvedAccount) {
      issues.push({ sheet: "Transactions", row: row.row, reason: "Add an account first" });
      continue;
    }

    let toAccountId: string | undefined;
    if (row.kind === "transfer") {
      const resolvedDestination = destination ?? resolveAccount(row.toAccountId, row.toAccount);
      if (!resolvedDestination || resolvedDestination.id === resolvedAccount.id) {
        issues.push({ sheet: "Transactions", row: row.row, reason: "Pick two different accounts" });
        continue;
      }
      toAccountId = resolvedDestination.id;
    }

    const resolvedCategory = categoryIsEmpty
      ? row.kind === "transfer"
        ? ensureFallbackCategory(TRANSFER_CATEGORY_ID, "Transfer", true, "#64748b", "ArrowLeftRight")
        : ensureFallbackCategory(UNCATEGORIZED_ID, "Uncategorized", false, "#94a3b8", "CircleDashed")
      : (category ?? resolveCategory(row.categoryId, row.category, row.kind === "income" ? "income" : "expense"));
    if (!resolvedCategory) continue;

    const kind =
      row.kind === "income" || row.kind === "refund" ? kindForMoneyIn(resolvedCategory) : row.kind;
    const transaction: Transaction = {
      id,
      amountCents: row.amountCents,
      kind,
      accountId: resolvedAccount.id,
      toAccountId,
      description: row.description,
      merchantKey: row.merchantKey || toMerchantKey(row.description),
      categoryId: resolvedCategory.id,
      date: row.date,
      notes: row.notes || undefined,
      createdAt: stamp,
      updatedAt: stamp,
    };
    transactionIds.add(id);
    newTransactions.push(transaction);
  }

  for (const row of parsed.budgets) {
    if (row.id && budgetIds.has(row.id)) {
      skipped.budgets += 1;
      continue;
    }

    const category =
      !row.categoryId.trim() && !row.category.trim()
        ? ensureFallbackCategory(UNCATEGORIZED_ID, "Uncategorized", false, "#94a3b8", "CircleDashed")
        : resolveCategory(row.categoryId, row.category, "expense");
    if (!category) continue;
    if (budgetCategoryIds.has(category.id)) {
      skipped.budgets += 1;
      continue;
    }

    const id = row.id || newId();
    if (budgetIds.has(id)) {
      skipped.budgets += 1;
      continue;
    }

    const budget: Budget = {
      id,
      categoryId: category.id,
      amountCents: row.amountCents,
      period: row.period,
      createdAt: stamp,
      updatedAt: stamp,
    };
    budgetIds.add(id);
    budgetCategoryIds.add(category.id);
    newBudgets.push(budget);
  }

  for (const row of parsed.valuations) {
    if (row.id && valuationIds.has(row.id)) {
      skipped.valuations += 1;
      continue;
    }

    const account = accountOrDefault(row.accountId, row.account, "Valuations", row.row);
    if (!account) continue;

    const id = row.id || newId();
    if (valuationIds.has(id)) {
      skipped.valuations += 1;
      continue;
    }

    const log: ValuationLog = {
      id,
      accountId: account.id,
      valueCents: row.valueCents,
      date: row.date,
      createdAt: stamp,
    };
    valuationIds.add(id);
    newValuations.push(log);
  }

  return {
    accounts: newAccounts,
    categories: newCategories,
    transactions: newTransactions,
    budgets: newBudgets,
    valuationLogs: newValuations,
    skipped,
    issues,
  };
}

function snapshotToParsed(snapshot: LedgerSnapshot): ParsedWorkbook {
  const accountName = indexById(snapshot.accounts);
  const categoryName = indexById(snapshot.categories);
  return {
    accounts: snapshot.accounts.map((account, index) => ({
      row: index + 1,
      id: account.id,
      name: account.name,
      type: account.type,
      slug: account.slug,
      openingBalanceCents: account.openingBalanceCents,
      isArchived: account.isArchived,
    })),
    categories: snapshot.categories.map((category, index) => ({
      row: index + 1,
      id: category.id,
      name: category.name,
      kind: category.kind,
      color: category.color,
      icon: category.icon ?? "",
      parentId: category.parentId ?? "",
      isArchived: category.isArchived,
    })),
    transactions: snapshot.transactions.map((transaction, index) => ({
      row: index + 1,
      id: transaction.id,
      date: transaction.date,
      kind: transaction.kind,
      amountCents: transaction.amountCents,
      description: transaction.description,
      accountId: transaction.accountId,
      account: accountName.get(transaction.accountId) ?? "",
      toAccountId: transaction.toAccountId ?? "",
      toAccount: transaction.toAccountId ? (accountName.get(transaction.toAccountId) ?? "") : "",
      categoryId: transaction.categoryId,
      category: categoryName.get(transaction.categoryId) ?? "",
      notes: transaction.notes ?? "",
      merchantKey: transaction.merchantKey,
    })),
    budgets: snapshot.budgets.map((budget, index) => ({
      row: index + 1,
      id: budget.id,
      categoryId: budget.categoryId,
      category: categoryName.get(budget.categoryId) ?? "",
      amountCents: budget.amountCents,
      period: budget.period,
    })),
    valuations: snapshot.valuationLogs.map((log, index) => ({
      row: index + 1,
      id: log.id,
      accountId: log.accountId,
      account: accountName.get(log.accountId) ?? "",
      date: log.date,
      valueCents: log.valueCents,
    })),
    issues: [],
  };
}

function parseWorkbook(data: ArrayBuffer): ParsedWorkbook {
  const parsed: ParsedWorkbook = {
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    valuations: [],
    issues: [],
  };

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array", cellDates: true });
  } catch {
    parsed.issues.push({ sheet: "Workbook", row: 0, reason: "Could not read this Excel file" });
    return parsed;
  }

  let recognized = 0;
  const accounts = readSheet(workbook, "Accounts");
  const categories = readSheet(workbook, "Categories");
  const transactions = readSheet(workbook, "Transactions");
  const budgets = readSheet(workbook, "Budgets");
  const valuations = readSheet(workbook, "Valuations");
  if (accounts) recognized += 1;
  if (categories) recognized += 1;
  if (transactions) recognized += 1;
  if (budgets) recognized += 1;
  if (valuations) recognized += 1;

  if (recognized === 0) {
    parsed.issues.push({ sheet: "Workbook", row: 0, reason: "This workbook has none of the FinTrack sheets" });
    return parsed;
  }

  accounts?.forEach((raw, index) => parseAccountRow(raw, index + 2, parsed));
  categories?.forEach((raw, index) => parseCategoryRow(raw, index + 2, parsed));
  transactions?.forEach((raw, index) => parseTransactionRow(raw, index + 2, parsed));
  budgets?.forEach((raw, index) => parseBudgetRow(raw, index + 2, parsed));
  valuations?.forEach((raw, index) => parseValuationRow(raw, index + 2, parsed));
  return parsed;
}

function parseAccountRow(raw: Record<string, unknown>, row: number, parsed: ParsedWorkbook) {
  if (isBlank(raw, ["id", "name", "type", "slug", "openingBalance", "archived"])) return;
  const name = cellString(raw.name);
  const type = parseAccountType(raw.type);
  const opening = raw.openingBalance === "" ? 0 : parseCents(raw.openingBalance);
  const archived = parseArchived(raw.archived);
  if (!name) {
    parsed.issues.push({ sheet: "Accounts", row, reason: "Need a name" });
    return;
  }
  if (!type) {
    parsed.issues.push({ sheet: "Accounts", row, reason: "Unknown account type" });
    return;
  }
  if (opening === null) {
    parsed.issues.push({ sheet: "Accounts", row, reason: "Need an amount" });
    return;
  }
  if (archived === null) {
    parsed.issues.push({ sheet: "Accounts", row, reason: "Unknown archived value" });
    return;
  }
  parsed.accounts.push({
    row,
    id: cellString(raw.id),
    name,
    type,
    slug: cellString(raw.slug),
    openingBalanceCents: opening,
    isArchived: archived,
  });
}

function parseCategoryRow(raw: Record<string, unknown>, row: number, parsed: ParsedWorkbook) {
  if (isBlank(raw, ["id", "name", "kind", "color", "icon", "parentId", "archived"])) return;
  const name = cellString(raw.name);
  const kind = parseCategoryKind(raw.kind);
  const archived = parseArchived(raw.archived);
  if (!name) {
    parsed.issues.push({ sheet: "Categories", row, reason: "Need a name" });
    return;
  }
  if (!kind) {
    parsed.issues.push({ sheet: "Categories", row, reason: "Unknown category kind" });
    return;
  }
  if (archived === null) {
    parsed.issues.push({ sheet: "Categories", row, reason: "Unknown archived value" });
    return;
  }
  parsed.categories.push({
    row,
    id: cellString(raw.id),
    name,
    kind,
    color: cellString(raw.color),
    icon: cellString(raw.icon),
    parentId: cellString(raw.parentId),
    isArchived: archived,
  });
}

function parseTransactionRow(raw: Record<string, unknown>, row: number, parsed: ParsedWorkbook) {
  if (
    isBlank(raw, [
      "id",
      "date",
      "kind",
      "amount",
      "description",
      "accountId",
      "account",
      "toAccountId",
      "toAccount",
      "categoryId",
      "category",
      "notes",
      "merchantKey",
    ])
  ) {
    return;
  }
  const date = parseDateCell(raw.date);
  const kind = parseTransactionKind(raw.kind);
  const amount = parseCents(raw.amount);
  const description = cellString(raw.description);
  if (!date) {
    parsed.issues.push({ sheet: "Transactions", row, reason: "Need a date" });
    return;
  }
  if (!kind) {
    parsed.issues.push({ sheet: "Transactions", row, reason: "Unknown kind" });
    return;
  }
  if (amount === null || amount <= 0) {
    parsed.issues.push({ sheet: "Transactions", row, reason: "Need an amount" });
    return;
  }
  if (!description) {
    parsed.issues.push({ sheet: "Transactions", row, reason: "Add a description" });
    return;
  }
  parsed.transactions.push({
    row,
    id: cellString(raw.id),
    date,
    kind,
    amountCents: amount,
    description,
    accountId: cellString(raw.accountId),
    account: cellString(raw.account),
    toAccountId: cellString(raw.toAccountId),
    toAccount: cellString(raw.toAccount),
    categoryId: cellString(raw.categoryId),
    category: cellString(raw.category),
    notes: cellString(raw.notes),
    merchantKey: cellString(raw.merchantKey),
  });
}

function parseBudgetRow(raw: Record<string, unknown>, row: number, parsed: ParsedWorkbook) {
  if (isBlank(raw, ["id", "categoryId", "category", "amount", "period"])) return;
  const amount = parseCents(raw.amount);
  const period = cellString(raw.period).toLowerCase();
  if (amount === null || amount <= 0) {
    parsed.issues.push({ sheet: "Budgets", row, reason: "Need an amount" });
    return;
  }
  if (period && period !== "monthly") {
    parsed.issues.push({ sheet: "Budgets", row, reason: "Unknown period" });
    return;
  }
  parsed.budgets.push({
    row,
    id: cellString(raw.id),
    categoryId: cellString(raw.categoryId),
    category: cellString(raw.category),
    amountCents: amount,
    period: "monthly",
  });
}

function parseValuationRow(raw: Record<string, unknown>, row: number, parsed: ParsedWorkbook) {
  if (isBlank(raw, ["id", "accountId", "account", "date", "value"])) return;
  const date = parseDateCell(raw.date);
  const value = parseCents(raw.value);
  if (!date) {
    parsed.issues.push({ sheet: "Valuations", row, reason: "Need a date" });
    return;
  }
  if (value === null) {
    parsed.issues.push({ sheet: "Valuations", row, reason: "Need an amount" });
    return;
  }
  parsed.valuations.push({
    row,
    id: cellString(raw.id),
    accountId: cellString(raw.accountId),
    account: cellString(raw.account),
    date,
    valueCents: value,
  });
}

function readSheet(workbook: XLSX.WorkBook, name: string): Record<string, unknown>[] | null {
  const found = workbook.SheetNames.find((sheetName) => sheetName.trim().toLowerCase() === name.toLowerCase());
  if (!found) return null;
  const sheet = workbook.Sheets[found];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.trim()] = value;
    }
    return normalized;
  });
}

function appendSheet(
  workbook: XLSX.WorkBook,
  name: (typeof SHEET_NAMES)[number],
  headers: readonly string[],
  rows: Record<string, unknown>[],
  moneyColumns: string[] = [],
) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...headers] });
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(header.length + 2, 14) }));
  for (const column of moneyColumns) formatNumberColumn(sheet, headers, column);
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function formatNumberColumn(sheet: XLSX.WorkSheet, headers: readonly string[], column: string) {
  const index = headers.indexOf(column);
  if (index < 0 || !sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let row = 1; row <= range.e.r; row += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: index })];
    if (cell && cell.t === "n") cell.z = "0.00";
  }
}

function indexById(records: Array<{ id: string; name: string }>): Map<string, string> {
  return new Map(records.map((record) => [record.id, record.name]));
}

function centsToDecimal(cents: number): number {
  return cents / 100;
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}

function sameAccountRef(
  left: Account | undefined,
  leftId: string,
  leftName: string,
  right: Account | undefined,
  rightId: string,
  rightName: string,
): boolean {
  if (left && right) return left.id === right.id;
  if (left || right) return false;
  const requestedLeft = leftId.trim();
  const requestedRight = rightId.trim();
  if (requestedLeft && requestedLeft === requestedRight) return true;
  const leftLabel = (leftName.trim() || requestedLeft).toLowerCase();
  const rightLabel = (rightName.trim() || requestedRight).toLowerCase();
  if (leftLabel && leftLabel === rightLabel) return true;
  const leftSlug = toAccountSlug(leftName);
  const rightSlug = toAccountSlug(rightName);
  return leftSlug !== "" && leftSlug === rightSlug;
}

function countLabel(count: number, singular: string, plural: string): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function isBlank(raw: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => {
    const value = raw[key];
    return !(value instanceof Date) && typeof value !== "number" && cellString(value) === "";
  });
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    return "";
  }
  return String(value).trim();
}

function parseCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0) return null;
    return Math.round(value * 100);
  }
  if (typeof value === "string") {
    const cents = parseAmountToken(value.trim());
    if (cents === null || cents < 0) return null;
    return cents;
  }
  return null;
}

function parseArchived(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  const text = cellString(value).toLowerCase();
  if (!text) return false;
  if (text === "yes" || text === "true" || text === "y") return true;
  if (text === "no" || text === "false" || text === "n") return false;
  return null;
}

function parseAccountType(value: unknown): AccountType | null {
  const text = cellString(value).toLowerCase();
  return ACCOUNT_TYPES.has(text as AccountType) ? (text as AccountType) : null;
}

function parseCategoryKind(value: unknown): CategoryKind | null {
  const text = cellString(value).toLowerCase();
  return CATEGORY_KINDS.has(text as CategoryKind) ? (text as CategoryKind) : null;
}

function parseTransactionKind(value: unknown): TransactionKind | null {
  const text = cellString(value).toLowerCase();
  return TRANSACTION_KINDS.has(text as TransactionKind) ? (text as TransactionKind) : null;
}

function parseDateCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = toISODate(value);
    return isRealISODate(iso) ? iso : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const iso = `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    return isRealISODate(iso) ? iso : null;
  }
  const text = cellString(value);
  return isRealISODate(text) ? text : null;
}

function isRealISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
