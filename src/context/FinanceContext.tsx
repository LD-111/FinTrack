import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  isPortfolioAccount,
  matchAccountToken,
  matchArchivedAccountToken,
  planAccountDeletion,
  suggestTransferDestination,
  uniqueAccountSlug,
} from "@/lib/accounts";
import { toast } from "@/lib/toast";
import { isSpendingCategory, kindAfterCategoryChange, kindForMoneyIn, resolveCategory } from "@/lib/categorizer";
import { currentYearMonth, todayISO } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  accountBalances as deriveAccountBalances,
  categorySpendForMonth,
  compareTransactionsDesc,
  summarizeMonth,
  type AccountBalance,
  type CategorySpend,
  type MonthSummary,
} from "@/lib/derived";
import { parseQuickAdd } from "@/lib/parser";
import {
  overlayPortfolioValues,
  portfolioViews,
  type PortfolioPoint,
  type PortfolioView,
} from "@/lib/portfolio";
import { formatMoney } from "@/lib/money";
import { DEFAULT_SETTINGS, seedIfEmpty } from "@/lib/seed";
import type {
  Account,
  AccountType,
  AppSettings,
  AppView,
  Budget,
  Category,
  DashboardTab,
  MerchantMemory,
  PortfolioSnapshot,
  QuickAddOverrides,
  QuickAddPreview,
  QuickAddResult,
  Transaction,
  ValuationLog,
} from "@/lib/types";
import { DEFAULT_ACCOUNT_ID, TRANSFER_CATEGORY_ID } from "@/lib/types";
import { newId, nowIso, toMerchantKey } from "@/lib/utils";

type MemoryLink = { memoryId?: string; previousMemory?: MerchantMemory };

type UndoItem =
  | ({ type: "add-tx"; id: string } & MemoryLink)
  | { type: "delete-tx"; transaction: Transaction }
  | ({ type: "update-tx"; previous: Transaction } & MemoryLink)
  | { type: "upsert-budget"; previous: Budget | null; id: string }
  | { type: "add-valuation"; id: string }
  | { type: "delete-valuation"; log: ValuationLog }
  | {
      type: "import";
      accountIds: string[];
      categoryIds: string[];
      transactionIds: string[];
      budgetIds: string[];
      valuationIds: string[];
    }
  | {
      type: "delete-account";
      account: Account;
      transactions: Transaction[];
      logs: ValuationLog[];
      previousDefaultAccountId: string;
    };

interface ShellState {
  hydrated: boolean;
  view: AppView;
  selectedMonth: string;
  accountFilter: string;
  dashboardTab: DashboardTab;
  selectedPortfolioAccountId: string | null;
  settings: AppSettings;
}

interface LedgerState {
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  merchantMemory: MerchantMemory[];
  monthSummary: MonthSummary;
  categorySpend: CategorySpend[];
  accountBalances: AccountBalance[];
  categoryById: (id: string) => Category | undefined;
  accountById: (id: string) => Account | undefined;
}

interface PortfolioState {
  valuationLogs: ValuationLog[];
  portfolioSnapshots: PortfolioSnapshot[];
  seriesByAccountId: ReadonlyMap<string, PortfolioPoint[]>;
}

interface FinanceActions {
  setView: (view: AppView) => void;
  setSelectedMonth: (month: string) => void;
  setAccountFilter: (accountId: string) => void;
  setDashboardTab: (tab: DashboardTab) => void;
  setSelectedPortfolioAccountId: (accountId: string | null) => void;
  quickAddRef: RefObject<HTMLInputElement | null>;
  previewQuickAdd: (raw: string) => QuickAddPreview;
  addTransactionFromQuickAdd: (raw: string, overrides?: QuickAddOverrides) => QuickAddResult;
  updateTransaction: (id: string, patch: Partial<Omit<Transaction, "id" | "createdAt">>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  createAccount: (input: { name: string; type: AccountType; openingBalanceCents?: number }) => Promise<Account | null>;
  updateAccount: (id: string, patch: Partial<Omit<Account, "id" | "createdAt">>) => Promise<void>;
  archiveAccount: (id: string) => Promise<void>;
  unarchiveAccount: (id: string) => Promise<void>;
  deleteAccount: (id: string) => Promise<boolean>;
  addValuationLog: (input: { accountId: string; valueCents: number; date?: string }) => Promise<ValuationLog | null>;
  deleteValuationLog: (id: string) => Promise<void>;
  upsertBudget: (categoryId: string, amountCents: number) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  undo: () => Promise<boolean>;
  exportWorkbook: () => void;
  importWorkbook: (data: ArrayBuffer) => Promise<void>;
  focusQuickAdd: () => void;
}

export interface FinanceContextValue extends ShellState, LedgerState, PortfolioState, FinanceActions {}

const ShellContext = createContext<ShellState | null>(null);
const LedgerContext = createContext<LedgerState | null>(null);
const PortfolioContext = createContext<PortfolioState | null>(null);
const ActionsContext = createContext<FinanceActions | null>(null);

function missingProvider(): never {
  throw new Error("useFinance must be used within FinanceProvider");
}

function portfolioSignature(views: PortfolioView[]): string {
  return JSON.stringify(
    views.map(({ snapshot, series }) => ({
      id: snapshot.account.id,
      name: snapshot.account.name,
      type: snapshot.account.type,
      slug: snapshot.account.slug,
      archived: snapshot.account.isArchived,
      opening: snapshot.account.openingBalanceCents,
      principal: snapshot.investedPrincipalCents,
      value: snapshot.currentValueCents,
      profit: snapshot.profitCents,
      twr: snapshot.twrRatio,
      valuation: snapshot.lastValuation?.id ?? null,
      series,
    })),
  );
}

function isISODate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [view, setViewState] = useState<AppView>("dashboard");
  const [selectedMonth, setSelectedMonthState] = useState(currentYearMonth);
  const [accountFilter, setAccountFilterState] = useState("all");
  const [dashboardTab, setDashboardTabState] = useState<DashboardTab>("cashflow");
  const [selectedPortfolioAccountId, setSelectedPortfolioAccountIdState] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [categories, setCategoriesState] = useState<Category[]>([]);
  const [accounts, setAccountsState] = useState<Account[]>([]);
  const [transactions, setTransactionsState] = useState<Transaction[]>([]);
  const [budgets, setBudgetsState] = useState<Budget[]>([]);
  const [merchantMemory, setMerchantMemoryState] = useState<MerchantMemory[]>([]);
  const [valuationLogs, setValuationLogsState] = useState<ValuationLog[]>([]);
  const quickAddRef = useRef<HTMLInputElement | null>(null);
  const undoStack = useRef<UndoItem[]>([]);
  const transactionWrites = useRef(new Map<string, Promise<void>>());
  const memoryWrites = useRef(Promise.resolve());
  const portfolioCache = useRef<{
    signature: string;
    snapshots: PortfolioSnapshot[];
    seriesByAccountId: Map<string, PortfolioPoint[]>;
  } | null>(null);

  const settingsRef = useRef(settings);
  const categoriesRef = useRef(categories);
  const accountsRef = useRef(accounts);
  const transactionsRef = useRef(transactions);
  const budgetsRef = useRef(budgets);
  const merchantMemoryRef = useRef(merchantMemory);
  const valuationLogsRef = useRef(valuationLogs);
  const accountFilterRef = useRef(accountFilter);
  const selectedPortfolioAccountIdRef = useRef(selectedPortfolioAccountId);

  const commitSettings = useCallback((next: AppSettings) => {
    settingsRef.current = next;
    setSettingsState(next);
  }, []);
  const commitCategories = useCallback((next: Category[]) => {
    categoriesRef.current = next;
    setCategoriesState(next);
  }, []);
  const commitAccounts = useCallback((next: Account[]) => {
    accountsRef.current = next;
    setAccountsState(next);
  }, []);
  const commitTransactions = useCallback((next: Transaction[]) => {
    transactionsRef.current = next;
    setTransactionsState(next);
  }, []);
  const commitBudgets = useCallback((next: Budget[]) => {
    budgetsRef.current = next;
    setBudgetsState(next);
  }, []);
  const commitMemory = useCallback((next: MerchantMemory[]) => {
    merchantMemoryRef.current = next;
    setMerchantMemoryState(next);
  }, []);
  const commitLogs = useCallback((next: ValuationLog[]) => {
    valuationLogsRef.current = next;
    setValuationLogsState(next);
  }, []);
  const commitAccountFilter = useCallback((next: string) => {
    accountFilterRef.current = next;
    setAccountFilterState(next);
  }, []);
  const commitPortfolioAccount = useCallback((next: string | null) => {
    selectedPortfolioAccountIdRef.current = next;
    setSelectedPortfolioAccountIdState(next);
  }, []);

  const pushUndo = useCallback((item: UndoItem) => {
    undoStack.current = [...undoStack.current.slice(-19), item];
  }, []);

  const restoreMemory = useCallback(
    async (link: MemoryLink) => {
      if (link.previousMemory) {
        const restored = link.previousMemory;
        commitMemory(merchantMemoryRef.current.map((memory) => (memory.id === restored.id ? restored : memory)));
        await db.merchantMemory.put(restored);
      } else if (link.memoryId) {
        const memoryId = link.memoryId;
        commitMemory(merchantMemoryRef.current.filter((memory) => memory.id !== memoryId));
        await db.merchantMemory.delete(memoryId);
      }
    },
    [commitMemory],
  );

  const noteMemory = useCallback(
    (item: Extract<UndoItem, { type: "add-tx" | "update-tx" }>, link: MemoryLink) => {
      if (!undoStack.current.includes(item)) {
        void restoreMemory(link);
        return;
      }
      item.memoryId = link.memoryId;
      item.previousMemory = link.previousMemory;
    },
    [restoreMemory],
  );

  const rememberMerchant = useCallback(
    (merchantKey: string, categoryId: string) => {
      const run = memoryWrites.current.then(async () => {
        if (!merchantKey) return { memoryId: undefined, previousMemory: undefined };
        const existing = merchantMemoryRef.current.find((memory) => memory.merchantKey === merchantKey);
        const stamp = nowIso();
        if (existing) {
          const updated: MerchantMemory = {
            ...existing,
            categoryId,
            hitCount: existing.hitCount + 1,
            lastUsedAt: stamp,
          };
          commitMemory(merchantMemoryRef.current.map((memory) => (memory.id === existing.id ? updated : memory)));
          await db.merchantMemory.put(updated);
          return { memoryId: existing.id, previousMemory: existing };
        }
        const created: MerchantMemory = {
          id: newId(),
          merchantKey,
          categoryId,
          hitCount: 1,
          lastUsedAt: stamp,
        };
        commitMemory([...merchantMemoryRef.current, created]);
        await db.merchantMemory.put(created);
        return { memoryId: created.id, previousMemory: undefined };
      });
      memoryWrites.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [commitMemory],
  );

  const undoItemFromToast = useCallback((item: UndoItem, revert: (item: UndoItem) => Promise<void>) => {
    if (!undoStack.current.includes(item)) return;
    undoStack.current = undoStack.current.filter((entry) => entry !== item);
    void revert(item);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      await seedIfEmpty();
      const [nextCategories, nextAccounts, nextTransactions, nextBudgets, nextMemory, nextSettings, nextLogs] =
        await Promise.all([
          db.categories.toArray(),
          db.accounts.toArray(),
          db.transactions.orderBy("date").reverse().toArray(),
          db.budgets.toArray(),
          db.merchantMemory.toArray(),
          db.settings.get("default"),
          db.valuationLogs.toArray(),
        ]);

      const categoriesById = new Map(nextCategories.map((category) => [category.id, category]));
      const stamp = nowIso();
      const migratedTransactions = nextTransactions.map((transaction) => {
        if (transaction.kind !== "income" || !isSpendingCategory(categoriesById.get(transaction.categoryId))) {
          return transaction;
        }
        return { ...transaction, kind: "refund" as const, updatedAt: stamp };
      });
      const rewritten = migratedTransactions.filter((transaction, index) => transaction !== nextTransactions[index]);
      if (rewritten.length > 0) {
        await db.transactions.bulkPut(rewritten);
      }

      if (cancelled) return;
      const sortedTransactions = [...migratedTransactions].sort(compareTransactionsDesc);
      commitCategories(nextCategories);
      commitAccounts(nextAccounts);
      commitTransactions(sortedTransactions);
      commitBudgets(nextBudgets);
      commitMemory(nextMemory);
      commitLogs(nextLogs);
      commitSettings({
        ...DEFAULT_SETTINGS,
        ...nextSettings,
        defaultAccountId: nextSettings?.defaultAccountId ?? DEFAULT_ACCOUNT_ID,
      });
      const firstPortfolio = nextAccounts.find((account) => !account.isArchived && isPortfolioAccount(account));
      commitPortfolioAccount(firstPortfolio?.id ?? null);
      setHydrated(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [commitAccounts, commitBudgets, commitCategories, commitLogs, commitMemory, commitPortfolioAccount, commitSettings, commitTransactions]);

  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const categoryById = useCallback((id: string) => categoriesById.get(id), [categoriesById]);
  const accountById = useCallback((id: string) => accountsById.get(id), [accountsById]);

  const actions = useMemo<FinanceActions>(() => {
    function applyPatch(previous: Transaction, patch: Partial<Omit<Transaction, "id" | "createdAt">>): Transaction {
      const next: Transaction = { ...previous, ...patch, updatedAt: nowIso() };
      if (patch.categoryId && previous.kind !== "transfer") {
        next.kind = kindAfterCategoryChange(
          previous.kind,
          categoriesRef.current.find((category) => category.id === patch.categoryId),
        );
      }
      return next;
    }

    async function revertUndoItem(item: UndoItem) {
      if (item.type === "add-tx") {
        commitTransactions(transactionsRef.current.filter((transaction) => transaction.id !== item.id));
        await db.transactions.delete(item.id);
        await restoreMemory(item);
        return;
      }
      if (item.type === "delete-tx") {
        commitTransactions([...transactionsRef.current, item.transaction].sort(compareTransactionsDesc));
        await db.transactions.put(item.transaction);
        return;
      }
      if (item.type === "update-tx") {
        commitTransactions(
          transactionsRef.current.map((transaction) =>
            transaction.id === item.previous.id ? item.previous : transaction,
          ),
        );
        await db.transactions.put(item.previous);
        await restoreMemory(item);
        return;
      }
      if (item.type === "add-valuation") {
        commitLogs(valuationLogsRef.current.filter((log) => log.id !== item.id));
        await db.valuationLogs.delete(item.id);
        return;
      }
      if (item.type === "delete-valuation") {
        commitLogs([...valuationLogsRef.current, item.log]);
        await db.valuationLogs.put(item.log);
        return;
      }
      if (item.type === "import") {
        const accountIds = new Set(item.accountIds);
        const categoryIds = new Set(item.categoryIds);
        const transactionIds = new Set(item.transactionIds);
        const budgetIds = new Set(item.budgetIds);
        const valuationIds = new Set(item.valuationIds);
        commitAccounts(accountsRef.current.filter((account) => !accountIds.has(account.id)));
        commitCategories(categoriesRef.current.filter((category) => !categoryIds.has(category.id)));
        commitTransactions(transactionsRef.current.filter((transaction) => !transactionIds.has(transaction.id)));
        commitBudgets(budgetsRef.current.filter((budget) => !budgetIds.has(budget.id)));
        commitLogs(valuationLogsRef.current.filter((log) => !valuationIds.has(log.id)));
        await db.transaction("rw", db.accounts, db.categories, db.transactions, db.budgets, db.valuationLogs, async () => {
          if (item.transactionIds.length > 0) await db.transactions.bulkDelete(item.transactionIds);
          if (item.budgetIds.length > 0) await db.budgets.bulkDelete(item.budgetIds);
          if (item.valuationIds.length > 0) await db.valuationLogs.bulkDelete(item.valuationIds);
          if (item.accountIds.length > 0) await db.accounts.bulkDelete(item.accountIds);
          if (item.categoryIds.length > 0) await db.categories.bulkDelete(item.categoryIds);
        });
        return;
      }
      if (item.type === "delete-account") {
        const accountsNext = accountsRef.current.some((account) => account.id === item.account.id)
          ? accountsRef.current
          : [...accountsRef.current, item.account];
        commitAccounts(accountsNext);
        const ids = new Set(transactionsRef.current.map((transaction) => transaction.id));
        const missing = item.transactions.filter((transaction) => !ids.has(transaction.id));
        commitTransactions(
          missing.length === 0
            ? transactionsRef.current
            : [...transactionsRef.current, ...missing].sort(compareTransactionsDesc),
        );
        const logIds = new Set(valuationLogsRef.current.map((log) => log.id));
        const missingLogs = item.logs.filter((log) => !logIds.has(log.id));
        commitLogs(missingLogs.length === 0 ? valuationLogsRef.current : [...valuationLogsRef.current, ...missingLogs]);
        if (settingsRef.current.defaultAccountId !== item.previousDefaultAccountId) {
          commitSettings({ ...settingsRef.current, defaultAccountId: item.previousDefaultAccountId });
        }
        await db.transaction("rw", db.accounts, db.transactions, db.valuationLogs, db.settings, async () => {
          await db.accounts.put(item.account);
          if (item.transactions.length > 0) await db.transactions.bulkPut(item.transactions);
          if (item.logs.length > 0) await db.valuationLogs.bulkPut(item.logs);
          const stored = await db.settings.get("default");
          if (stored && stored.defaultAccountId !== item.previousDefaultAccountId) {
            await db.settings.put({ ...stored, defaultAccountId: item.previousDefaultAccountId });
          }
        });
        return;
      }
      const previousBudget = item.previous;
      if (previousBudget) {
        const exists = budgetsRef.current.some((budget) => budget.id === previousBudget.id);
        commitBudgets(
          exists
            ? budgetsRef.current.map((budget) => (budget.id === previousBudget.id ? previousBudget : budget))
            : [...budgetsRef.current, previousBudget],
        );
        await db.budgets.put(previousBudget);
      } else {
        commitBudgets(budgetsRef.current.filter((budget) => budget.id !== item.id));
        await db.budgets.delete(item.id);
      }
    }

    function previewQuickAdd(raw: string): QuickAddPreview {
      const accountsNow = accountsRef.current;
      const categoriesNow = categoriesRef.current;
      const parsed = parseQuickAdd(raw, todayISO(), categoriesNow);
      if (!parsed.ok) return { raw, valid: false, reason: parsed.reason };

      const fallbackAccount =
        accountsNow.find((account) => account.id === settingsRef.current.defaultAccountId) ??
        accountsNow.find((account) => !account.isArchived);

      const archivedNameFor = (token: string | undefined): string | undefined => {
        if (!token) return undefined;
        const needle = token.trim().toLowerCase().replace(/^#/, "");
        if (!needle) return undefined;
        const activeHit = accountsNow.some(
          (account) =>
            !account.isArchived &&
            (account.slug === needle ||
              account.name.toLowerCase() === needle ||
              account.slug.startsWith(needle) ||
              account.name.toLowerCase().startsWith(needle)),
        );
        if (activeHit) return undefined;
        return matchArchivedAccountToken(token, accountsNow)?.name;
      };

      if (parsed.kind === "transfer") {
        const from = parsed.accountToken ? matchAccountToken(parsed.accountToken, accountsNow) : undefined;
        if (!from) {
          const archivedName = archivedNameFor(parsed.accountToken);
          return {
            raw,
            valid: false,
            reason: archivedName
              ? `${archivedName} is archived`
              : parsed.accountToken
                ? "Unknown account"
                : "Transfer needs #from and #to",
          };
        }
        const explicitTo = parsed.toAccountToken ? matchAccountToken(parsed.toAccountToken, accountsNow) : undefined;
        if (parsed.toAccountToken && !explicitTo) {
          const archivedName = archivedNameFor(parsed.toAccountToken);
          return { raw, valid: false, reason: archivedName ? `${archivedName} is archived` : "Unknown account" };
        }
        if (explicitTo && explicitTo.id === from.id) return { raw, valid: false, reason: "Pick two different accounts" };
        const suggestion = explicitTo
          ? undefined
          : suggestTransferDestination(from.id, parsed.amountCents, transactionsRef.current, accountsNow);
        const to = explicitTo ?? (suggestion ? accountsNow.find((account) => account.id === suggestion.toAccountId) : undefined);
        if (!to || to.id === from.id) {
          return {
            raw,
            valid: false,
            reason: "Pick #to",
            amountCents: parsed.amountCents,
            kind: "transfer",
            accountId: from.id,
            accountName: from.name,
            date: parsed.date,
          };
        }
        const description = parsed.description || suggestion?.description || `${from.name} → ${to.name}`;
        return {
          raw,
          valid: true,
          amountCents: parsed.amountCents,
          kind: "transfer",
          description,
          merchantKey: parsed.description ? parsed.merchantKey : toMerchantKey(description),
          categoryId: TRANSFER_CATEGORY_ID,
          categoryName: "Transfer",
          accountId: from.id,
          accountName: from.name,
          toAccountId: to.id,
          toAccountName: to.name,
          toAccountSource: explicitTo ? "explicit" : "memory",
          date: parsed.date,
        };
      }

      const account = parsed.accountToken ? matchAccountToken(parsed.accountToken, accountsNow) : fallbackAccount;
      if (parsed.accountToken && !account) {
        const archivedName = archivedNameFor(parsed.accountToken);
        return {
          raw,
          valid: false,
          reason: archivedName ? `${archivedName} is archived` : `No account matches #${parsed.accountToken}`,
        };
      }
      if (!account) return { raw, valid: false, reason: "Add an account first" };

      const resolved = resolveCategory({
        categoryToken: parsed.categoryToken,
        merchantKey: parsed.merchantKey,
        categories: categoriesNow,
        merchantMemory: merchantMemoryRef.current,
      });
      const resolvedCategory = categoriesNow.find((category) => category.id === resolved.categoryId);
      const kind = parsed.kind === "income" ? kindForMoneyIn(resolvedCategory) : parsed.kind;
      return {
        raw,
        valid: true,
        amountCents: parsed.amountCents,
        kind,
        description: parsed.description,
        merchantKey: parsed.merchantKey,
        categoryId: resolved.categoryId,
        categoryName: resolvedCategory?.name ?? "Uncategorized",
        categorySource: resolved.source,
        accountId: account.id,
        accountName: account.name,
        date: parsed.date,
      };
    }

    function addTransactionFromQuickAdd(raw: string, overrides?: QuickAddOverrides): QuickAddResult {
      const preview = previewQuickAdd(raw);
      const accountId = overrides?.accountId ?? preview.accountId;
      const date = isISODate(overrides?.date) ? overrides.date : preview.date;
      let toAccountId = preview.kind === "transfer" ? (overrides?.toAccountId ?? preview.toAccountId) : undefined;
      let description = preview.description ?? "";
      let merchantKey = preview.merchantKey ?? "";
      let kind = preview.kind;

      if (kind && kind !== "transfer" && overrides?.categoryId) {
        const category = categoriesRef.current.find((item) => item.id === overrides.categoryId);
        if (kind === "income" || kind === "refund") kind = kindForMoneyIn(category);
      }
      if (kind === "transfer" && toAccountId) {
        const fromName = preview.accountName ?? accountsRef.current.find((account) => account.id === accountId)?.name ?? "Account";
        const to = accountsRef.current.find((account) => account.id === toAccountId);
        const generated = preview.toAccountName ? `${fromName} → ${preview.toAccountName}` : undefined;
        const destinationChanged = Boolean(overrides?.toAccountId && overrides.toAccountId !== preview.toAccountId);
        if (
          to &&
          (destinationChanged || !description) &&
          (!description || description === generated || preview.toAccountSource === "memory" || !preview.valid)
        ) {
          description = `${fromName} → ${to.name}`;
          merchantKey = toMerchantKey(description);
        }
      }

      const categoryId = kind === "transfer" ? TRANSFER_CATEGORY_ID : (overrides?.categoryId ?? preview.categoryId);
      if (!preview.amountCents || !kind || !date || !accountId || !categoryId) {
        return { ok: false, reason: preview.reason ?? "Need an amount" };
      }
      if (kind === "transfer" && (!toAccountId || toAccountId === accountId)) {
        return { ok: false, reason: preview.reason ?? "Transfer needs #from and #to" };
      }
      if (kind !== "transfer" && !description) return { ok: false, reason: preview.reason ?? "Add a description" };
      if (!preview.valid && !(kind === "transfer" && toAccountId)) {
        return { ok: false, reason: preview.reason ?? "Need an amount" };
      }

      const stamp = nowIso();
      const transaction: Transaction = {
        id: newId(),
        amountCents: preview.amountCents,
        kind,
        accountId,
        toAccountId: kind === "transfer" ? toAccountId : undefined,
        description,
        merchantKey: merchantKey || (description ? toMerchantKey(description) : ""),
        categoryId,
        date,
        createdAt: stamp,
        updatedAt: stamp,
      };
      commitTransactions([...transactionsRef.current, transaction].sort(compareTransactionsDesc));
      void db.transactions.put(transaction);
      void persistDefaultAccount(transaction.accountId);
      const undoItem: Extract<UndoItem, { type: "add-tx" }> = { type: "add-tx", id: transaction.id };
      pushUndo(undoItem);
      if (transaction.kind !== "transfer" && transaction.merchantKey) {
        void rememberMerchant(transaction.merchantKey, transaction.categoryId).then((memory) => noteMemory(undoItem, memory));
      }
      toast("Added", {
        description: transaction.description,
        action: { label: "Undo", onClick: () => undoItemFromToast(undoItem, revertUndoItem) },
        duration: 5000,
      });
      return { ok: true, transaction };
    }

    async function persistDefaultAccount(accountId: string) {
      if (!accountId || settingsRef.current.defaultAccountId === accountId) return;
      const next: AppSettings = { ...settingsRef.current, defaultAccountId: accountId };
      commitSettings(next);
      await db.settings.put(next);
    }

    function enqueueTransaction(id: string, task: () => Promise<void>) {
      const previous = transactionWrites.current.get(id) ?? Promise.resolve();
      const job = previous.then(task, task);
      transactionWrites.current.set(
        id,
        job.then(
          () => undefined,
          () => undefined,
        ),
      );
      return job;
    }

    function updateTransaction(id: string, patch: Partial<Omit<Transaction, "id" | "createdAt">>) {
      return enqueueTransaction(id, async () => {
        const previous = transactionsRef.current.find((transaction) => transaction.id === id);
        if (!previous) return;
        const next = applyPatch(previous, patch);
        commitTransactions(transactionsRef.current.map((transaction) => (transaction.id === id ? next : transaction)));
        const undoItem: Extract<UndoItem, { type: "update-tx" }> = { type: "update-tx", previous };
        pushUndo(undoItem);
        await db.transactions.put(next);
        if (patch.categoryId && next.merchantKey && next.kind !== "transfer") {
          const memory = await rememberMerchant(next.merchantKey, next.categoryId);
          noteMemory(undoItem, memory);
        }
      });
    }

    async function deleteTransaction(id: string) {
      const previous = transactionsRef.current.find((transaction) => transaction.id === id);
      if (!previous) return;
      commitTransactions(transactionsRef.current.filter((transaction) => transaction.id !== id));
      await db.transactions.delete(id);
      const undoItem: Extract<UndoItem, { type: "delete-tx" }> = { type: "delete-tx", transaction: previous };
      pushUndo(undoItem);
      toast("Deleted", {
        description: previous.description,
        action: { label: "Undo", onClick: () => undoItemFromToast(undoItem, revertUndoItem) },
        duration: 5000,
      });
    }

    async function createAccount(input: { name: string; type: AccountType; openingBalanceCents?: number }) {
      const name = input.name.trim();
      if (!name) return null;
      const stamp = nowIso();
      const account: Account = {
        id: newId(),
        name,
        type: input.type,
        slug: uniqueAccountSlug(name, accountsRef.current),
        openingBalanceCents: input.openingBalanceCents ?? 0,
        isArchived: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      commitAccounts([...accountsRef.current, account]);
      await db.accounts.put(account);
      return account;
    }

    async function updateAccount(id: string, patch: Partial<Omit<Account, "id" | "createdAt">>) {
      const previous = accountsRef.current.find((account) => account.id === id);
      if (!previous) return;
      const next: Account = {
        ...previous,
        ...patch,
        slug: patch.name
          ? uniqueAccountSlug(patch.name, accountsRef.current.filter((account) => account.id !== id))
          : previous.slug,
        updatedAt: nowIso(),
      };
      commitAccounts(accountsRef.current.map((account) => (account.id === id ? next : account)));
      await db.accounts.put(next);
    }

    async function archiveAccount(id: string) {
      const previous = accountsRef.current.find((account) => account.id === id);
      if (!previous || previous.isArchived) return;
      const active = accountsRef.current.filter((account) => !account.isArchived && account.id !== id);
      if (active.length === 0) return;
      const next: Account = { ...previous, isArchived: true, updatedAt: nowIso() };
      commitAccounts(accountsRef.current.map((account) => (account.id === id ? next : account)));
      await db.accounts.put(next);
      if (settingsRef.current.defaultAccountId === id) await persistDefaultAccount(active[0].id);
      if (accountFilterRef.current === id) commitAccountFilter("all");
      if (selectedPortfolioAccountIdRef.current === id) {
        commitPortfolioAccount(active.find((account) => isPortfolioAccount(account))?.id ?? null);
      }
    }

    async function unarchiveAccount(id: string) {
      const previous = accountsRef.current.find((account) => account.id === id);
      if (!previous || !previous.isArchived) return;
      const next: Account = { ...previous, isArchived: false, updatedAt: nowIso() };
      commitAccounts(accountsRef.current.map((account) => (account.id === id ? next : account)));
      await db.accounts.put(next);
    }

    async function deleteAccount(id: string) {
      const previous = accountsRef.current.find((account) => account.id === id);
      if (!previous) return false;
      const active = accountsRef.current.filter((account) => !account.isArchived && account.id !== id);
      if (active.length === 0) return false;
      const plan = planAccountDeletion(id, transactionsRef.current, valuationLogsRef.current);
      const transactionIds = new Set(plan.transactionIds);
      const valuationIds = new Set(plan.valuationIds);
      const removedTransactions = transactionsRef.current.filter((transaction) => transactionIds.has(transaction.id));
      const removedLogs = valuationLogsRef.current.filter((log) => valuationIds.has(log.id));
      const previousDefaultAccountId = settingsRef.current.defaultAccountId;
      const nextDefaultId = previousDefaultAccountId === id ? active[0].id : previousDefaultAccountId;
      const previousFilter = accountFilterRef.current;
      const previousPortfolioId = selectedPortfolioAccountIdRef.current;
      const accountsBefore = accountsRef.current;
      const transactionsBefore = transactionsRef.current;
      const logsBefore = valuationLogsRef.current;
      const settingsBefore = settingsRef.current;

      commitAccounts(accountsBefore.filter((account) => account.id !== id));
      commitTransactions(transactionsBefore.filter((transaction) => !transactionIds.has(transaction.id)));
      commitLogs(logsBefore.filter((log) => !valuationIds.has(log.id)));
      if (nextDefaultId !== previousDefaultAccountId) {
        commitSettings({ ...settingsBefore, defaultAccountId: nextDefaultId });
      }
      if (previousFilter === id) commitAccountFilter("all");
      if (previousPortfolioId === id) {
        commitPortfolioAccount(active.find((account) => isPortfolioAccount(account))?.id ?? null);
      }

      const undoItem: Extract<UndoItem, { type: "delete-account" }> = {
        type: "delete-account",
        account: previous,
        transactions: removedTransactions,
        logs: removedLogs,
        previousDefaultAccountId,
      };

      try {
        await db.transaction("rw", db.accounts, db.transactions, db.valuationLogs, db.settings, async () => {
          if (plan.transactionIds.length > 0) await db.transactions.bulkDelete(plan.transactionIds);
          if (plan.valuationIds.length > 0) await db.valuationLogs.bulkDelete(plan.valuationIds);
          await db.accounts.delete(id);
          if (nextDefaultId !== previousDefaultAccountId) {
            await db.settings.put({ ...settingsRef.current, defaultAccountId: nextDefaultId });
          }
        });
      } catch {
        commitAccounts(accountsBefore);
        commitTransactions(transactionsBefore);
        commitLogs(logsBefore);
        commitSettings(settingsBefore);
        commitAccountFilter(previousFilter);
        commitPortfolioAccount(previousPortfolioId);
        toast("Could not remove account", { description: previous.name });
        return false;
      }

      pushUndo(undoItem);
      toast("Account removed", {
        description: previous.name,
        action: { label: "Undo", onClick: () => undoItemFromToast(undoItem, revertUndoItem) },
        duration: 5000,
      });
      return true;
    }

    async function addValuationLog(input: { accountId: string; valueCents: number; date?: string }) {
      if (!input.accountId || !Number.isFinite(input.valueCents) || input.valueCents < 0) return null;
      const log: ValuationLog = {
        id: newId(),
        accountId: input.accountId,
        valueCents: input.valueCents,
        date: input.date ?? todayISO(),
        createdAt: nowIso(),
      };
      commitLogs([...valuationLogsRef.current, log]);
      await db.valuationLogs.put(log);
      const undoItem: Extract<UndoItem, { type: "add-valuation" }> = { type: "add-valuation", id: log.id };
      pushUndo(undoItem);
      toast("Value logged", {
        description: formatMoney(log.valueCents, settingsRef.current.currency, settingsRef.current.locale),
        action: { label: "Undo", onClick: () => undoItemFromToast(undoItem, revertUndoItem) },
        duration: 5000,
      });
      return log;
    }

    async function deleteValuationLog(id: string) {
      const previous = valuationLogsRef.current.find((log) => log.id === id);
      if (!previous) return;
      commitLogs(valuationLogsRef.current.filter((log) => log.id !== id));
      await db.valuationLogs.delete(id);
      const undoItem: Extract<UndoItem, { type: "delete-valuation" }> = { type: "delete-valuation", log: previous };
      pushUndo(undoItem);
      toast("Valuation removed", {
        action: { label: "Undo", onClick: () => undoItemFromToast(undoItem, revertUndoItem) },
        duration: 5000,
      });
    }

    async function upsertBudget(categoryId: string, amountCents: number) {
      const existing = budgetsRef.current.find((budget) => budget.categoryId === categoryId);
      const stamp = nowIso();
      if (amountCents <= 0) {
        if (!existing) return;
        commitBudgets(budgetsRef.current.filter((budget) => budget.id !== existing.id));
        await db.budgets.delete(existing.id);
        pushUndo({ type: "upsert-budget", previous: existing, id: existing.id });
        return;
      }
      if (existing && existing.amountCents === amountCents) return;
      const next: Budget = existing
        ? { ...existing, amountCents, updatedAt: stamp }
        : { id: newId(), categoryId, amountCents, period: "monthly", createdAt: stamp, updatedAt: stamp };
      commitBudgets(
        existing
          ? budgetsRef.current.map((budget) => (budget.id === existing.id ? next : budget))
          : [...budgetsRef.current, next],
      );
      await db.budgets.put(next);
      pushUndo({ type: "upsert-budget", previous: existing ?? null, id: next.id });
    }

    async function deleteBudget(id: string) {
      const existing = budgetsRef.current.find((budget) => budget.id === id);
      if (!existing) return;
      commitBudgets(budgetsRef.current.filter((budget) => budget.id !== id));
      await db.budgets.delete(id);
      pushUndo({ type: "upsert-budget", previous: existing, id });
    }

    function exportWorkbook() {
      const ledger = {
        accounts: accountsRef.current,
        categories: categoriesRef.current,
        transactions: transactionsRef.current,
        budgets: budgetsRef.current,
        valuationLogs: valuationLogsRef.current,
      };
      void import("@/lib/excel").then(({ downloadWorkbook }) => downloadWorkbook(ledger));
    }

    async function importWorkbook(data: ArrayBuffer) {
      const { planWorkbookImport, summarizeImport } = await import("@/lib/excel");
      const plan = planWorkbookImport(
        data,
        {
          accounts: accountsRef.current,
          categories: categoriesRef.current,
          transactions: transactionsRef.current,
          budgets: budgetsRef.current,
          valuationLogs: valuationLogsRef.current,
        },
        settingsRef.current.defaultAccountId,
      );
      const inserted =
        plan.accounts.length +
        plan.categories.length +
        plan.transactions.length +
        plan.budgets.length +
        plan.valuationLogs.length;
      const summary = summarizeImport(plan);
      if (inserted === 0) {
        toast(summary.title, { description: summary.description, duration: 6000 });
        return;
      }
      commitCategories([...categoriesRef.current, ...plan.categories]);
      commitAccounts([...accountsRef.current, ...plan.accounts]);
      commitTransactions([...transactionsRef.current, ...plan.transactions].sort(compareTransactionsDesc));
      commitBudgets([...budgetsRef.current, ...plan.budgets]);
      commitLogs([...valuationLogsRef.current, ...plan.valuationLogs]);
      const undoItem: Extract<UndoItem, { type: "import" }> = {
        type: "import",
        accountIds: plan.accounts.map((account) => account.id),
        categoryIds: plan.categories.map((category) => category.id),
        transactionIds: plan.transactions.map((transaction) => transaction.id),
        budgetIds: plan.budgets.map((budget) => budget.id),
        valuationIds: plan.valuationLogs.map((log) => log.id),
      };
      try {
        await db.transaction("rw", db.accounts, db.categories, db.transactions, db.budgets, db.valuationLogs, async () => {
          if (plan.categories.length > 0) await db.categories.bulkAdd(plan.categories);
          if (plan.accounts.length > 0) await db.accounts.bulkAdd(plan.accounts);
          if (plan.transactions.length > 0) await db.transactions.bulkAdd(plan.transactions);
          if (plan.budgets.length > 0) await db.budgets.bulkAdd(plan.budgets);
          if (plan.valuationLogs.length > 0) await db.valuationLogs.bulkAdd(plan.valuationLogs);
        });
      } catch {
        await revertUndoItem(undoItem);
        toast("Import failed", { description: "Could not save the imported rows" });
        return;
      }
      pushUndo(undoItem);
      toast(summary.title, {
        description: summary.description,
        duration: 6000,
        action: { label: "Undo", onClick: () => undoItemFromToast(undoItem, revertUndoItem) },
      });
    }

    async function undo() {
      const item = undoStack.current.pop();
      if (!item) return false;
      await revertUndoItem(item);
      return true;
    }

    return {
      setView: setViewState,
      setSelectedMonth: setSelectedMonthState,
      setAccountFilter: commitAccountFilter,
      setDashboardTab: setDashboardTabState,
      setSelectedPortfolioAccountId: commitPortfolioAccount,
      quickAddRef,
      previewQuickAdd,
      addTransactionFromQuickAdd,
      updateTransaction,
      deleteTransaction,
      createAccount,
      updateAccount,
      archiveAccount,
      unarchiveAccount,
      deleteAccount,
      addValuationLog,
      deleteValuationLog,
      upsertBudget,
      deleteBudget,
      undo,
      exportWorkbook,
      importWorkbook,
      focusQuickAdd: () => {
        quickAddRef.current?.focus();
        quickAddRef.current?.select();
      },
    };
  }, [
    commitAccountFilter,
    commitAccounts,
    commitBudgets,
    commitCategories,
    commitLogs,
    commitMemory,
    commitPortfolioAccount,
    commitSettings,
    commitTransactions,
    noteMemory,
    pushUndo,
    rememberMerchant,
    restoreMemory,
    undoItemFromToast,
  ]);

  const monthSummary = useMemo(() => summarizeMonth(transactions, selectedMonth), [selectedMonth, transactions]);
  const categorySpend = useMemo(
    () => categorySpendForMonth(transactions, categories, budgets, selectedMonth),
    [budgets, categories, selectedMonth, transactions],
  );
  const portfolioModel = useMemo(() => {
    const views = portfolioViews(accounts, transactions, valuationLogs);
    const signature = portfolioSignature(views);
    if (portfolioCache.current?.signature === signature) return portfolioCache.current;
    const next = {
      signature,
      snapshots: views.map((view) => view.snapshot),
      seriesByAccountId: new Map(views.map((view) => [view.snapshot.account.id, view.series])),
    };
    portfolioCache.current = next;
    return next;
  }, [accounts, transactions, valuationLogs]);
  const accountBalanceRows = useMemo(
    () => overlayPortfolioValues(deriveAccountBalances(accounts, transactions), portfolioModel.snapshots),
    [accounts, portfolioModel.snapshots, transactions],
  );

  useEffect(() => {
    const active = accounts.filter((account) => !account.isArchived && isPortfolioAccount(account));
    if (selectedPortfolioAccountId && active.some((account) => account.id === selectedPortfolioAccountId)) {
      selectedPortfolioAccountIdRef.current = selectedPortfolioAccountId;
      return;
    }
    commitPortfolioAccount(active[0]?.id ?? null);
  }, [accounts, commitPortfolioAccount, selectedPortfolioAccountId]);

  const shellValue = useMemo<ShellState>(
    () => ({
      hydrated,
      view,
      selectedMonth,
      accountFilter,
      dashboardTab,
      selectedPortfolioAccountId,
      settings,
    }),
    [accountFilter, dashboardTab, hydrated, selectedMonth, selectedPortfolioAccountId, settings, view],
  );
  const ledgerValue = useMemo<LedgerState>(
    () => ({
      categories,
      accounts,
      transactions,
      budgets,
      merchantMemory,
      monthSummary,
      categorySpend,
      accountBalances: accountBalanceRows,
      categoryById,
      accountById,
    }),
    [
      accountBalanceRows,
      accountById,
      accounts,
      budgets,
      categories,
      categoryById,
      categorySpend,
      merchantMemory,
      monthSummary,
      transactions,
    ],
  );
  const portfolioValue = useMemo<PortfolioState>(
    () => ({
      valuationLogs,
      portfolioSnapshots: portfolioModel.snapshots,
      seriesByAccountId: portfolioModel.seriesByAccountId,
    }),
    [portfolioModel, valuationLogs],
  );

  return (
    <ShellContext.Provider value={shellValue}>
      <LedgerContext.Provider value={ledgerValue}>
        <PortfolioContext.Provider value={portfolioValue}>
          <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
        </PortfolioContext.Provider>
      </LedgerContext.Provider>
    </ShellContext.Provider>
  );
}

export function useShell(): ShellState {
  return useContext(ShellContext) ?? missingProvider();
}

export function useLedger(): LedgerState {
  return useContext(LedgerContext) ?? missingProvider();
}

export function usePortfolio(): PortfolioState {
  return useContext(PortfolioContext) ?? missingProvider();
}

export function useFinanceActions(): FinanceActions {
  return useContext(ActionsContext) ?? missingProvider();
}

export function useFinance(): FinanceContextValue {
  const shell = useContext(ShellContext);
  const ledger = useContext(LedgerContext);
  const portfolio = useContext(PortfolioContext);
  const financeActions = useContext(ActionsContext);
  if (!shell || !ledger || !portfolio || !financeActions) missingProvider();
  return { ...shell, ...ledger, ...portfolio, ...financeActions };
}
