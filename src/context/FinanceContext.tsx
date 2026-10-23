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
import { isPortfolioAccount, matchAccountToken, uniqueAccountSlug } from "@/lib/accounts";
import { toast } from "@/lib/toast";
import { resolveCategory } from "@/lib/categorizer";
import { currentYearMonth, todayISO } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  accountBalances as deriveAccountBalances,
  categorySpendForMonth,
  summarizeMonth,
  type AccountBalance,
  type CategorySpend,
  type MonthSummary,
} from "@/lib/derived";
import { parseQuickAdd } from "@/lib/parser";
import { overlayPortfolioValues, portfolioSnapshots as derivePortfolioSnapshots } from "@/lib/portfolio";
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
  QuickAddPreview,
  QuickAddResult,
  Transaction,
  ValuationLog,
} from "@/lib/types";
import { DEFAULT_ACCOUNT_ID, TRANSFER_CATEGORY_ID } from "@/lib/types";
import { newId, nowIso } from "@/lib/utils";

type UndoItem =
  | { type: "add-tx"; id: string; memoryId?: string; previousMemory?: MerchantMemory }
  | { type: "delete-tx"; transaction: Transaction }
  | { type: "update-tx"; previous: Transaction }
  | { type: "upsert-budget"; previous: Budget | null; id: string }
  | { type: "add-valuation"; id: string }
  | { type: "delete-valuation"; log: ValuationLog };

export interface FinanceContextValue {
  hydrated: boolean;
  view: AppView;
  setView: (view: AppView) => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  accountFilter: string;
  setAccountFilter: (accountId: string) => void;
  dashboardTab: DashboardTab;
  setDashboardTab: (tab: DashboardTab) => void;
  selectedPortfolioAccountId: string | null;
  setSelectedPortfolioAccountId: (accountId: string | null) => void;
  settings: AppSettings;
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  merchantMemory: MerchantMemory[];
  valuationLogs: ValuationLog[];
  monthSummary: MonthSummary;
  categorySpend: CategorySpend[];
  accountBalances: AccountBalance[];
  portfolioSnapshots: PortfolioSnapshot[];
  quickAddRef: RefObject<HTMLInputElement | null>;
  previewQuickAdd: (raw: string) => QuickAddPreview;
  addTransactionFromQuickAdd: (raw: string) => QuickAddResult;
  updateTransaction: (id: string, patch: Partial<Omit<Transaction, "id" | "createdAt">>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  createAccount: (input: { name: string; type: AccountType; openingBalanceCents?: number }) => Promise<Account | null>;
  updateAccount: (id: string, patch: Partial<Omit<Account, "id" | "createdAt">>) => Promise<void>;
  archiveAccount: (id: string) => Promise<void>;
  addValuationLog: (input: { accountId: string; valueCents: number; date?: string }) => Promise<ValuationLog | null>;
  deleteValuationLog: (id: string) => Promise<void>;
  upsertBudget: (categoryId: string, amountCents: number) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  undo: () => Promise<boolean>;
  focusQuickAdd: () => void;
  categoryById: (id: string) => Category | undefined;
  accountById: (id: string) => Account | undefined;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<AppView>("dashboard");
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [accountFilter, setAccountFilter] = useState("all");
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("cashflow");
  const [selectedPortfolioAccountId, setSelectedPortfolioAccountId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [merchantMemory, setMerchantMemory] = useState<MerchantMemory[]>([]);
  const [valuationLogs, setValuationLogs] = useState<ValuationLog[]>([]);
  const quickAddRef = useRef<HTMLInputElement | null>(null);
  const undoStack = useRef<UndoItem[]>([]);

  const pushUndo = useCallback((item: UndoItem) => {
    undoStack.current = [...undoStack.current.slice(-19), item];
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

      if (cancelled) return;
      setCategories(nextCategories);
      setAccounts(nextAccounts);
      setTransactions(nextTransactions);
      setBudgets(nextBudgets);
      setMerchantMemory(nextMemory);
      setValuationLogs(nextLogs);
      setSettings({
        ...DEFAULT_SETTINGS,
        ...nextSettings,
        defaultAccountId: nextSettings?.defaultAccountId ?? DEFAULT_ACCOUNT_ID,
      });
      const firstPortfolio = nextAccounts.find((account) => !account.isArchived && isPortfolioAccount(account));
      setSelectedPortfolioAccountId(firstPortfolio?.id ?? null);
      setHydrated(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryById = useCallback(
    (id: string) => categories.find((category) => category.id === id),
    [categories],
  );

  const accountById = useCallback(
    (id: string) => accounts.find((account) => account.id === id),
    [accounts],
  );

  const persistDefaultAccount = useCallback(
    async (accountId: string) => {
      if (!accountId || settings.defaultAccountId === accountId) return;
      const next: AppSettings = { ...settings, defaultAccountId: accountId };
      setSettings(next);
      await db.settings.put(next);
    },
    [settings],
  );

  const previewQuickAdd = useCallback(
    (raw: string): QuickAddPreview => {
      const parsed = parseQuickAdd(raw);
      if (!parsed.ok) {
        return { raw, valid: false, reason: parsed.reason };
      }

      const fallbackAccount =
        accountById(settings.defaultAccountId) ?? accounts.find((account) => !account.isArchived);

      if (parsed.kind === "transfer") {
        const from = parsed.accountToken ? matchAccountToken(parsed.accountToken, accounts) : undefined;
        const to = parsed.toAccountToken ? matchAccountToken(parsed.toAccountToken, accounts) : undefined;
        if (!from || !to) {
          return { raw, valid: false, reason: "Unknown account" };
        }
        if (from.id === to.id) {
          return { raw, valid: false, reason: "Pick two different accounts" };
        }

        const description = parsed.description || `${from.name} → ${to.name}`;
        return {
          raw,
          valid: true,
          amountCents: parsed.amountCents,
          kind: "transfer",
          description,
          merchantKey: parsed.merchantKey,
          categoryId: TRANSFER_CATEGORY_ID,
          categoryName: "Transfer",
          accountId: from.id,
          accountName: from.name,
          toAccountId: to.id,
          toAccountName: to.name,
          date: parsed.date,
        };
      }

      const account = parsed.accountToken
        ? matchAccountToken(parsed.accountToken, accounts)
        : fallbackAccount;
      if (parsed.accountToken && !account) {
        return { raw, valid: false, reason: `No account matches #${parsed.accountToken}` };
      }
      if (!account) {
        return { raw, valid: false, reason: "Add an account first" };
      }

      const resolved = resolveCategory({
        categoryToken: parsed.categoryToken,
        merchantKey: parsed.merchantKey,
        categories,
        merchantMemory,
      });

      return {
        raw,
        valid: true,
        amountCents: parsed.amountCents,
        kind: parsed.kind,
        description: parsed.description,
        merchantKey: parsed.merchantKey,
        categoryId: resolved.categoryId,
        categoryName: categoryById(resolved.categoryId)?.name ?? "Uncategorized",
        categorySource: resolved.source,
        accountId: account.id,
        accountName: account.name,
        date: parsed.date,
      };
    },
    [accountById, accounts, categories, categoryById, merchantMemory, settings.defaultAccountId],
  );

  const rememberMerchant = useCallback(
    async (merchantKey: string, categoryId: string) => {
      if (!merchantKey) return { memoryId: undefined, previousMemory: undefined };
      const existing = merchantMemory.find((memory) => memory.merchantKey === merchantKey);
      const stamp = nowIso();

      if (existing) {
        const updated: MerchantMemory = {
          ...existing,
          categoryId,
          hitCount: existing.hitCount + 1,
          lastUsedAt: stamp,
        };
        setMerchantMemory((current) =>
          current.map((memory) => (memory.id === existing.id ? updated : memory)),
        );
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
      setMerchantMemory((current) => [...current, created]);
      await db.merchantMemory.put(created);
      return { memoryId: created.id, previousMemory: undefined };
    },
    [merchantMemory],
  );

  const addTransactionFromQuickAdd = useCallback(
    (raw: string): QuickAddResult => {
      const preview = previewQuickAdd(raw);
      if (
        !preview.valid ||
        !preview.amountCents ||
        !preview.kind ||
        !preview.description ||
        !preview.date ||
        !preview.categoryId ||
        !preview.accountId
      ) {
        return { ok: false, reason: preview.reason ?? "Need an amount" };
      }
      if (preview.kind === "transfer" && !preview.toAccountId) {
        return { ok: false, reason: preview.reason ?? "Transfer needs #from and #to" };
      }

      const stamp = nowIso();
      const transaction: Transaction = {
        id: newId(),
        amountCents: preview.amountCents,
        kind: preview.kind,
        accountId: preview.accountId,
        toAccountId: preview.kind === "transfer" ? preview.toAccountId : undefined,
        description: preview.description,
        merchantKey: preview.merchantKey ?? "",
        categoryId: preview.categoryId,
        date: preview.date,
        createdAt: stamp,
        updatedAt: stamp,
      };

      setTransactions((current) => [transaction, ...current]);
      void db.transactions.put(transaction);
      void persistDefaultAccount(transaction.accountId);
      if (transaction.kind !== "transfer") {
        void rememberMerchant(transaction.merchantKey, transaction.categoryId).then((memory) => {
          pushUndo({ type: "add-tx", id: transaction.id, ...memory });
        });
      } else {
        pushUndo({ type: "add-tx", id: transaction.id });
      }

      toast("Added", {
        description: transaction.description,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              undoStack.current = undoStack.current.filter((item) => !(item.type === "add-tx" && item.id === transaction.id));
              setTransactions((current) => current.filter((item) => item.id !== transaction.id));
              await db.transactions.delete(transaction.id);
            })();
          },
        },
        duration: 5000,
      });

      return { ok: true, transaction };
    },
    [persistDefaultAccount, previewQuickAdd, pushUndo, rememberMerchant],
  );

  const updateTransaction = useCallback(
    async (id: string, patch: Partial<Omit<Transaction, "id" | "createdAt">>) => {
      const previous = transactions.find((transaction) => transaction.id === id);
      if (!previous) return;

      const next: Transaction = {
        ...previous,
        ...patch,
        updatedAt: nowIso(),
      };
      setTransactions((current) => current.map((transaction) => (transaction.id === id ? next : transaction)));
      await db.transactions.put(next);
      pushUndo({ type: "update-tx", previous });

      if (patch.categoryId && next.merchantKey && next.kind !== "transfer") {
        await rememberMerchant(next.merchantKey, next.categoryId);
      }
    },
    [pushUndo, rememberMerchant, transactions],
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      const previous = transactions.find((transaction) => transaction.id === id);
      if (!previous) return;
      setTransactions((current) => current.filter((transaction) => transaction.id !== id));
      await db.transactions.delete(id);
      pushUndo({ type: "delete-tx", transaction: previous });
      toast("Deleted", {
        description: previous.description,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              setTransactions((current) => [previous, ...current]);
              await db.transactions.put(previous);
            })();
          },
        },
        duration: 5000,
      });
    },
    [pushUndo, transactions],
  );

  const createAccount = useCallback(
    async (input: { name: string; type: AccountType; openingBalanceCents?: number }) => {
      const name = input.name.trim();
      if (!name) return null;

      const stamp = nowIso();
      const account: Account = {
        id: newId(),
        name,
        type: input.type,
        slug: uniqueAccountSlug(name, accounts),
        openingBalanceCents: input.openingBalanceCents ?? 0,
        isArchived: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      setAccounts((current) => [...current, account]);
      await db.accounts.put(account);
      return account;
    },
    [accounts],
  );

  const updateAccount = useCallback(
    async (id: string, patch: Partial<Omit<Account, "id" | "createdAt">>) => {
      const previous = accounts.find((account) => account.id === id);
      if (!previous) return;

      const next: Account = {
        ...previous,
        ...patch,
        slug: patch.name ? uniqueAccountSlug(patch.name, accounts.filter((account) => account.id !== id)) : previous.slug,
        updatedAt: nowIso(),
      };
      setAccounts((current) => current.map((account) => (account.id === id ? next : account)));
      await db.accounts.put(next);
    },
    [accounts],
  );

  const archiveAccount = useCallback(
    async (id: string) => {
      const previous = accounts.find((account) => account.id === id);
      if (!previous || previous.isArchived) return;

      const active = accounts.filter((account) => !account.isArchived && account.id !== id);
      if (active.length === 0) return;

      const next: Account = { ...previous, isArchived: true, updatedAt: nowIso() };
      setAccounts((current) => current.map((account) => (account.id === id ? next : account)));
      await db.accounts.put(next);

      if (settings.defaultAccountId === id) {
        await persistDefaultAccount(active[0].id);
      }
      if (accountFilter === id) {
        setAccountFilter("all");
      }
      if (selectedPortfolioAccountId === id) {
        const nextPortfolio = active.find((account) => isPortfolioAccount(account));
        setSelectedPortfolioAccountId(nextPortfolio?.id ?? null);
      }
    },
    [accountFilter, accounts, persistDefaultAccount, selectedPortfolioAccountId, settings.defaultAccountId],
  );

  const addValuationLog = useCallback(
    async (input: { accountId: string; valueCents: number; date?: string }) => {
      if (!input.accountId || !Number.isFinite(input.valueCents) || input.valueCents < 0) {
        return null;
      }

      const log: ValuationLog = {
        id: newId(),
        accountId: input.accountId,
        valueCents: input.valueCents,
        date: input.date ?? todayISO(),
        createdAt: nowIso(),
      };
      setValuationLogs((current) => [...current, log]);
      await db.valuationLogs.put(log);
      pushUndo({ type: "add-valuation", id: log.id });
      toast("Value logged", {
        description: formatMoney(log.valueCents, settings.currency, settings.locale),
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              undoStack.current = undoStack.current.filter(
                (item) => !(item.type === "add-valuation" && item.id === log.id),
              );
              setValuationLogs((current) => current.filter((item) => item.id !== log.id));
              await db.valuationLogs.delete(log.id);
            })();
          },
        },
        duration: 5000,
      });
      return log;
    },
    [pushUndo, settings.currency, settings.locale],
  );

  const deleteValuationLog = useCallback(
    async (id: string) => {
      const previous = valuationLogs.find((log) => log.id === id);
      if (!previous) return;
      setValuationLogs((current) => current.filter((log) => log.id !== id));
      await db.valuationLogs.delete(id);
      pushUndo({ type: "delete-valuation", log: previous });
      toast("Valuation removed", {
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              setValuationLogs((current) => [...current, previous]);
              await db.valuationLogs.put(previous);
            })();
          },
        },
        duration: 5000,
      });
    },
    [pushUndo, valuationLogs],
  );

  const upsertBudget = useCallback(
    async (categoryId: string, amountCents: number) => {
      const existing = budgets.find((budget) => budget.categoryId === categoryId);
      const stamp = nowIso();
      if (amountCents <= 0) {
        if (!existing) return;
        setBudgets((current) => current.filter((budget) => budget.id !== existing.id));
        await db.budgets.delete(existing.id);
        pushUndo({ type: "upsert-budget", previous: existing, id: existing.id });
        return;
      }

      const next: Budget = existing
        ? { ...existing, amountCents, updatedAt: stamp }
        : {
            id: newId(),
            categoryId,
            amountCents,
            period: "monthly",
            createdAt: stamp,
            updatedAt: stamp,
          };

      setBudgets((current) => {
        if (existing) {
          return current.map((budget) => (budget.id === existing.id ? next : budget));
        }
        return [...current, next];
      });
      await db.budgets.put(next);
      pushUndo({ type: "upsert-budget", previous: existing ?? null, id: next.id });
    },
    [budgets, pushUndo],
  );

  const deleteBudget = useCallback(
    async (id: string) => {
      const existing = budgets.find((budget) => budget.id === id);
      if (!existing) return;
      setBudgets((current) => current.filter((budget) => budget.id !== id));
      await db.budgets.delete(id);
      pushUndo({ type: "upsert-budget", previous: existing, id });
    },
    [budgets, pushUndo],
  );

  const undo = useCallback(async () => {
    const item = undoStack.current.pop();
    if (!item) return false;

    if (item.type === "add-tx") {
      setTransactions((current) => current.filter((transaction) => transaction.id !== item.id));
      await db.transactions.delete(item.id);
      if (item.previousMemory) {
        setMerchantMemory((current) =>
          current.map((memory) => (memory.id === item.previousMemory?.id ? item.previousMemory : memory)),
        );
        await db.merchantMemory.put(item.previousMemory);
      } else if (item.memoryId) {
        setMerchantMemory((current) => current.filter((memory) => memory.id !== item.memoryId));
        await db.merchantMemory.delete(item.memoryId);
      }
      return true;
    }

    if (item.type === "delete-tx") {
      setTransactions((current) => [item.transaction, ...current]);
      await db.transactions.put(item.transaction);
      return true;
    }

    if (item.type === "update-tx") {
      setTransactions((current) =>
        current.map((transaction) => (transaction.id === item.previous.id ? item.previous : transaction)),
      );
      await db.transactions.put(item.previous);
      return true;
    }

    if (item.type === "add-valuation") {
      setValuationLogs((current) => current.filter((log) => log.id !== item.id));
      await db.valuationLogs.delete(item.id);
      return true;
    }

    if (item.type === "delete-valuation") {
      setValuationLogs((current) => [...current, item.log]);
      await db.valuationLogs.put(item.log);
      return true;
    }

    const previousBudget = item.previous;
    if (previousBudget) {
      setBudgets((current) => {
        const exists = current.some((budget) => budget.id === previousBudget.id);
        if (exists) {
          return current.map((budget) => (budget.id === previousBudget.id ? previousBudget : budget));
        }
        return [...current, previousBudget];
      });
      await db.budgets.put(previousBudget);
    } else {
      setBudgets((current) => current.filter((budget) => budget.id !== item.id));
      await db.budgets.delete(item.id);
    }
    return true;
  }, []);

  const focusQuickAdd = useCallback(() => {
    quickAddRef.current?.focus();
    quickAddRef.current?.select();
  }, []);

  const monthSummary = useMemo(
    () => summarizeMonth(transactions, selectedMonth),
    [selectedMonth, transactions],
  );

  const categorySpend = useMemo(
    () => categorySpendForMonth(transactions, categories, budgets, selectedMonth),
    [budgets, categories, selectedMonth, transactions],
  );

  const portfolioSnapshotRows = useMemo(
    () => derivePortfolioSnapshots(accounts, transactions, valuationLogs),
    [accounts, transactions, valuationLogs],
  );

  const accountBalanceRows = useMemo(
    () => overlayPortfolioValues(deriveAccountBalances(accounts, transactions), portfolioSnapshotRows),
    [accounts, portfolioSnapshotRows, transactions],
  );

  useEffect(() => {
    const active = accounts.filter((account) => !account.isArchived && isPortfolioAccount(account));
    if (selectedPortfolioAccountId && active.some((account) => account.id === selectedPortfolioAccountId)) {
      return;
    }
    setSelectedPortfolioAccountId(active[0]?.id ?? null);
  }, [accounts, selectedPortfolioAccountId]);

  const value = useMemo<FinanceContextValue>(
    () => ({
      hydrated,
      view,
      setView,
      selectedMonth,
      setSelectedMonth,
      accountFilter,
      setAccountFilter,
      dashboardTab,
      setDashboardTab,
      selectedPortfolioAccountId,
      setSelectedPortfolioAccountId,
      settings,
      categories,
      accounts,
      transactions,
      budgets,
      merchantMemory,
      valuationLogs,
      monthSummary,
      categorySpend,
      accountBalances: accountBalanceRows,
      portfolioSnapshots: portfolioSnapshotRows,
      quickAddRef,
      previewQuickAdd,
      addTransactionFromQuickAdd,
      updateTransaction,
      deleteTransaction,
      createAccount,
      updateAccount,
      archiveAccount,
      addValuationLog,
      deleteValuationLog,
      upsertBudget,
      deleteBudget,
      undo,
      focusQuickAdd,
      categoryById,
      accountById,
    }),
    [
      accountBalanceRows,
      accountById,
      accountFilter,
      accounts,
      addTransactionFromQuickAdd,
      addValuationLog,
      archiveAccount,
      budgets,
      categories,
      categoryById,
      categorySpend,
      createAccount,
      dashboardTab,
      deleteBudget,
      deleteTransaction,
      deleteValuationLog,
      focusQuickAdd,
      hydrated,
      merchantMemory,
      monthSummary,
      portfolioSnapshotRows,
      previewQuickAdd,
      selectedMonth,
      selectedPortfolioAccountId,
      settings,
      transactions,
      undo,
      updateAccount,
      updateTransaction,
      upsertBudget,
      valuationLogs,
      view,
    ],
  );

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceContextValue {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error("useFinance must be used within FinanceProvider");
  }
  return context;
}
