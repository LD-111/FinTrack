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
import { toast } from "@/lib/toast";
import { resolveCategory } from "@/lib/categorizer";
import { currentYearMonth } from "@/lib/dates";
import { db } from "@/lib/db";
import { categorySpendForMonth, summarizeMonth, type CategorySpend, type MonthSummary } from "@/lib/derived";
import { parseQuickAdd } from "@/lib/parser";
import { DEFAULT_SETTINGS, seedIfEmpty } from "@/lib/seed";
import type {
  AppSettings,
  AppView,
  Budget,
  Category,
  MerchantMemory,
  QuickAddPreview,
  QuickAddResult,
  Transaction,
} from "@/lib/types";
import { newId, nowIso } from "@/lib/utils";

type UndoItem =
  | { type: "add-tx"; id: string; memoryId?: string; previousMemory?: MerchantMemory }
  | { type: "delete-tx"; transaction: Transaction }
  | { type: "update-tx"; previous: Transaction }
  | { type: "upsert-budget"; previous: Budget | null; id: string };

export interface FinanceContextValue {
  hydrated: boolean;
  view: AppView;
  setView: (view: AppView) => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  settings: AppSettings;
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  merchantMemory: MerchantMemory[];
  monthSummary: MonthSummary;
  categorySpend: CategorySpend[];
  quickAddRef: RefObject<HTMLInputElement | null>;
  previewQuickAdd: (raw: string) => QuickAddPreview;
  addTransactionFromQuickAdd: (raw: string) => QuickAddResult;
  updateTransaction: (id: string, patch: Partial<Omit<Transaction, "id" | "createdAt">>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  upsertBudget: (categoryId: string, amountCents: number) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  undo: () => Promise<boolean>;
  focusQuickAdd: () => void;
  categoryById: (id: string) => Category | undefined;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<AppView>("dashboard");
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [merchantMemory, setMerchantMemory] = useState<MerchantMemory[]>([]);
  const quickAddRef = useRef<HTMLInputElement | null>(null);
  const undoStack = useRef<UndoItem[]>([]);

  const pushUndo = useCallback((item: UndoItem) => {
    undoStack.current = [...undoStack.current.slice(-19), item];
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      await seedIfEmpty();
      const [nextCategories, nextTransactions, nextBudgets, nextMemory, nextSettings] =
        await Promise.all([
          db.categories.toArray(),
          db.transactions.orderBy("date").reverse().toArray(),
          db.budgets.toArray(),
          db.merchantMemory.toArray(),
          db.settings.get("default"),
        ]);

      if (cancelled) return;
      setCategories(nextCategories);
      setTransactions(nextTransactions);
      setBudgets(nextBudgets);
      setMerchantMemory(nextMemory);
      setSettings(nextSettings ?? DEFAULT_SETTINGS);
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

  const previewQuickAdd = useCallback(
    (raw: string): QuickAddPreview => {
      const parsed = parseQuickAdd(raw);
      if (!parsed.ok) {
        return { raw, valid: false, reason: parsed.reason };
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
        date: parsed.date,
      };
    },
    [categories, categoryById, merchantMemory],
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
      if (!preview.valid || !preview.amountCents || !preview.kind || !preview.description || !preview.date || !preview.categoryId) {
        return { ok: false, reason: preview.reason ?? "Need an amount" };
      }

      const stamp = nowIso();
      const transaction: Transaction = {
        id: newId(),
        amountCents: preview.amountCents,
        kind: preview.kind,
        description: preview.description,
        merchantKey: preview.merchantKey ?? "",
        categoryId: preview.categoryId,
        date: preview.date,
        createdAt: stamp,
        updatedAt: stamp,
      };

      setTransactions((current) => [transaction, ...current]);
      void db.transactions.put(transaction);
      void rememberMerchant(transaction.merchantKey, transaction.categoryId).then((memory) => {
        pushUndo({ type: "add-tx", id: transaction.id, ...memory });
      });

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
    [previewQuickAdd, pushUndo, rememberMerchant],
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

      if (patch.categoryId && next.merchantKey) {
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

  const value = useMemo<FinanceContextValue>(
    () => ({
      hydrated,
      view,
      setView,
      selectedMonth,
      setSelectedMonth,
      settings,
      categories,
      transactions,
      budgets,
      merchantMemory,
      monthSummary,
      categorySpend,
      quickAddRef,
      previewQuickAdd,
      addTransactionFromQuickAdd,
      updateTransaction,
      deleteTransaction,
      upsertBudget,
      deleteBudget,
      undo,
      focusQuickAdd,
      categoryById,
    }),
    [
      addTransactionFromQuickAdd,
      budgets,
      categories,
      categoryById,
      categorySpend,
      deleteBudget,
      deleteTransaction,
      focusQuickAdd,
      hydrated,
      merchantMemory,
      monthSummary,
      previewQuickAdd,
      selectedMonth,
      settings,
      transactions,
      undo,
      updateTransaction,
      upsertBudget,
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
