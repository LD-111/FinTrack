import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useFinance } from "@/context/FinanceContext";
import { addDays, formatDisplayDate } from "@/lib/dates";
import { formatSignedMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Chip = "category" | "date";

export function QuickAddBar() {
  const {
    quickAddRef,
    previewQuickAdd,
    addTransactionFromQuickAdd,
    categories,
    updateTransaction,
    settings,
    categoryById,
  } = useFinance();
  const [value, setValue] = useState("");
  const [activeChip, setActiveChip] = useState<Chip | null>(null);
  const [categoryOverride, setCategoryOverride] = useState<string | null>(null);
  const [dateOverride, setDateOverride] = useState<string | null>(null);

  const preview = useMemo(() => previewQuickAdd(value), [previewQuickAdd, value]);
  const categoryId = categoryOverride ?? preview.categoryId;
  const date = dateOverride ?? preview.date;
  const category = categoryId ? categoryById(categoryId) : undefined;
  const usableCategories = categories.filter((item) => !item.isArchived);

  useEffect(() => {
    setCategoryOverride(null);
    setDateOverride(null);
    setActiveChip(null);
  }, [value]);

  function commit(raw = value) {
    const suffix = [
      categoryOverride ? `@${categoryById(categoryOverride)?.name ?? ""}` : "",
      dateOverride && dateOverride !== preview.date ? dateOverride : "",
    ]
      .filter(Boolean)
      .join(" ");

    const result = addTransactionFromQuickAdd(suffix ? `${raw} ${suffix}` : raw);
    if (!result.ok) return;

    if (categoryOverride && result.transaction.categoryId !== categoryOverride) {
      void updateTransaction(result.transaction.id, { categoryId: categoryOverride });
    }
    if (dateOverride && result.transaction.date !== dateOverride) {
      void updateTransaction(result.transaction.id, { date: dateOverride });
    }

    setValue("");
    setCategoryOverride(null);
    setDateOverride(null);
    setActiveChip(null);
    requestAnimationFrame(() => quickAddRef.current?.focus());
  }

  function cycleCategory(direction: 1 | -1) {
    const currentIndex = usableCategories.findIndex((item) => item.id === categoryId);
    const nextIndex = (currentIndex + direction + usableCategories.length) % usableCategories.length;
    setCategoryOverride(usableCategories[nextIndex]?.id ?? null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setValue("");
      setActiveChip(null);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        setActiveChip((current) => (current === "date" ? "category" : current === "category" ? null : "date"));
      } else {
        setActiveChip((current) => (current === null ? "category" : current === "category" ? "date" : null));
      }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (activeChip === "category") {
        event.preventDefault();
        cycleCategory(direction);
      }
      if (activeChip === "date" && date) {
        event.preventDefault();
        setDateOverride(addDays(date, direction));
      }
    }
  }

  return (
    <div className="border-b bg-card/90 px-5 py-4 backdrop-blur">
      <label className="sr-only" htmlFor="quick-add">
        Quick add
      </label>
      <Input
        id="quick-add"
        ref={quickAddRef}
        value={value}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder='12.50 Chipotle  ·  +2500 Salary  ·  12,50 Coffee yesterday'
        className="h-12 border-input/80 bg-background text-base font-medium shadow-none"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-xs">
        {!value && (
          <p className="text-muted-foreground">
            Type an amount and a name. Enter logs it. Tab edits category or date.
          </p>
        )}
        {value && !preview.valid && (
          <p className="text-destructive">{preview.reason}</p>
        )}
        {value && preview.valid && preview.amountCents && preview.kind && date && (
          <>
            <Badge className={cn(preview.kind === "expense" ? "border-expense/30 text-expense" : "border-income/30 text-income")}>
              {formatSignedMoney(preview.amountCents, preview.kind, settings.currency, settings.locale)}
            </Badge>
            <Badge>{preview.description}</Badge>
            <Badge
              className={cn(
                "cursor-default",
                preview.categorySource !== "explicit" && !categoryOverride && "opacity-70",
                activeChip === "category" && "ring-2 ring-ring",
              )}
              style={category ? { borderColor: category.color, color: category.color } : undefined}
            >
              {category?.name ?? "Uncategorized"}
            </Badge>
            <Badge className={cn(activeChip === "date" && "ring-2 ring-ring")}>
              {formatDisplayDate(date, settings.locale)}
            </Badge>
          </>
        )}
      </div>
    </div>
  );
}
