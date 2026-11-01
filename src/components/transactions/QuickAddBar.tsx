import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useFinance } from "@/context/FinanceContext";
import { kindForMoneyIn } from "@/lib/categorizer";
import { addDays, formatDisplayDate } from "@/lib/dates";
import { formatSignedMoney } from "@/lib/money";
import { cn, toMerchantKey } from "@/lib/utils";

type Chip = "category" | "account" | "date";

export function QuickAddBar() {
  const {
    quickAddRef,
    previewQuickAdd,
    addTransactionFromQuickAdd,
    categories,
    accounts,
    updateTransaction,
    settings,
    categoryById,
    accountById,
  } = useFinance();
  const [value, setValue] = useState("");
  const [activeChip, setActiveChip] = useState<Chip | null>(null);
  const [categoryOverride, setCategoryOverride] = useState<string | null>(null);
  const [accountOverride, setAccountOverride] = useState<string | null>(null);
  const [toAccountOverride, setToAccountOverride] = useState<string | null>(null);
  const [dateOverride, setDateOverride] = useState<string | null>(null);

  const preview = useMemo(() => previewQuickAdd(value), [previewQuickAdd, value]);
  const isTransfer = preview.kind === "transfer";
  const categoryId = categoryOverride ?? preview.categoryId;
  const accountId = accountOverride ?? preview.accountId;
  const date = dateOverride ?? preview.date;
  const category = categoryId ? categoryById(categoryId) : undefined;
  const displayKind =
    preview.kind === "income" || preview.kind === "refund" ? kindForMoneyIn(category) : preview.kind;
  const account = accountId ? accountById(accountId) : undefined;
  const toAccountId = toAccountOverride ?? preview.toAccountId;
  const toAccount = toAccountId ? accountById(toAccountId) : undefined;
  const usableCategories = categories.filter((item) => !item.isArchived);
  const usableAccounts = accounts.filter((item) => !item.isArchived);
  const destinationChanged = Boolean(toAccountOverride && toAccountOverride !== preview.toAccountId);
  const fromLabel = preview.accountName ?? account?.name ?? "Account";
  const previousGenerated = preview.toAccountName ? `${fromLabel} → ${preview.toAccountName}` : undefined;
  const descriptionLabel =
    destinationChanged && toAccount
      ? !preview.description ||
        preview.description === previousGenerated ||
        preview.toAccountSource === "memory"
        ? `${fromLabel} → ${toAccount.name}`
        : preview.description
      : preview.description;

  useEffect(() => {
    setCategoryOverride(null);
    setAccountOverride(null);
    setToAccountOverride(null);
    setDateOverride(null);
    setActiveChip(null);
  }, [value]);

  function commit(raw = value) {
    const toSlug = destinationChanged ? accountById(toAccountOverride ?? "")?.slug : undefined;
    const suffix = [
      !isTransfer && categoryOverride ? `@${categoryById(categoryOverride)?.name ?? ""}` : "",
      !isTransfer && accountOverride ? `#${accountById(accountOverride)?.slug ?? ""}` : "",
      isTransfer && toSlug && preview.toAccountSource !== "explicit" ? `-> #${toSlug}` : "",
      dateOverride && dateOverride !== preview.date ? dateOverride : "",
    ]
      .filter(Boolean)
      .join(" ");

    const result = addTransactionFromQuickAdd(suffix ? `${raw} ${suffix}` : raw);
    if (!result.ok) return;

    if (!isTransfer && categoryOverride && result.transaction.categoryId !== categoryOverride) {
      void updateTransaction(result.transaction.id, { categoryId: categoryOverride });
    }
    if (!isTransfer && accountOverride && result.transaction.accountId !== accountOverride) {
      void updateTransaction(result.transaction.id, { accountId: accountOverride });
    }
    if (
      isTransfer &&
      destinationChanged &&
      toAccountOverride &&
      preview.toAccountSource === "explicit" &&
      result.transaction.toAccountId !== toAccountOverride
    ) {
      const nextToName = accountById(toAccountOverride)?.name ?? "Account";
      const description = `${fromLabel} → ${nextToName}`;
      void updateTransaction(result.transaction.id, {
        toAccountId: toAccountOverride,
        ...(result.transaction.description === previousGenerated
          ? { description, merchantKey: toMerchantKey(description) }
          : {}),
      });
    }
    if (dateOverride && result.transaction.date !== dateOverride) {
      void updateTransaction(result.transaction.id, { date: dateOverride });
    }

    setValue("");
    setCategoryOverride(null);
    setAccountOverride(null);
    setToAccountOverride(null);
    setDateOverride(null);
    setActiveChip(null);
    requestAnimationFrame(() => quickAddRef.current?.focus());
  }

  function cycleCategory(direction: 1 | -1) {
    const currentIndex = usableCategories.findIndex((item) => item.id === categoryId);
    const nextIndex = (currentIndex + direction + usableCategories.length) % usableCategories.length;
    setCategoryOverride(usableCategories[nextIndex]?.id ?? null);
  }

  function cycleAccount(direction: 1 | -1) {
    const currentIndex = usableAccounts.findIndex((item) => item.id === accountId);
    const nextIndex = (currentIndex + direction + usableAccounts.length) % usableAccounts.length;
    setAccountOverride(usableAccounts[nextIndex]?.id ?? null);
  }

  function cycleDestination(direction: 1 | -1) {
    const choices = usableAccounts.filter((item) => item.id !== accountId);
    if (choices.length === 0) return;
    const currentIndex = choices.findIndex((item) => item.id === toAccountId);
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : choices.length - 1
        : (currentIndex + direction + choices.length) % choices.length;
    setToAccountOverride(choices[nextIndex]?.id ?? null);
  }

  function nextChip(current: Chip | null, direction: 1 | -1): Chip | null {
    const chips: Array<Chip | null> = isTransfer
      ? [null, "account", "date"]
      : [null, "category", "account", "date"];
    const index = chips.indexOf(current);
    const nextIndex = (index + direction + chips.length) % chips.length;
    return chips[nextIndex] ?? null;
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
      setActiveChip((current) => nextChip(current, event.shiftKey ? -1 : 1));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (activeChip === "category") {
        event.preventDefault();
        cycleCategory(direction);
      }
      if (activeChip === "account") {
        event.preventDefault();
        if (isTransfer) cycleDestination(direction);
        else cycleAccount(direction);
      }
      if (activeChip === "date" && date) {
        event.preventDefault();
        setDateOverride(addDays(date, direction));
      }
    }
  }

  const amountTone =
    displayKind === "expense"
      ? "border-expense/30 text-expense"
      : displayKind === "income" || displayKind === "refund"
        ? "border-income/30 text-income"
        : "text-muted-foreground";

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
        placeholder="12.50 Chipotle #cash  ·  +2500 Salary  ·  500 #cash -> #savings"
        className="h-12 border-input/80 bg-background text-base font-medium shadow-none"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-xs">
        {!value && (
          <p className="text-muted-foreground">
            Type an amount and a name, or 500 #cash to start a transfer. Tab edits chips.
          </p>
        )}
        {value && !preview.valid && !(isTransfer && toAccountOverride) && (
          <p className="text-destructive">{preview.reason}</p>
        )}
        {value && preview.amountCents && preview.kind && date && (preview.valid || (isTransfer && preview.accountId)) && (
          <>
            <Badge className={amountTone}>
              {formatSignedMoney(preview.amountCents, displayKind ?? preview.kind, settings.currency, settings.locale)}
            </Badge>
            {descriptionLabel && <Badge>{descriptionLabel}</Badge>}
            {!isTransfer && (
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
            )}
            {displayKind === "refund" && <Badge className="border-income/30 text-income">Refund</Badge>}
            <Badge
              className={cn(
                "cursor-default",
                isTransfer && preview.toAccountSource === "memory" && !toAccountOverride && "opacity-70",
                activeChip === "account" && "ring-2 ring-ring",
              )}
            >
              {isTransfer ? `${fromLabel} → ${toAccount?.name ?? "…"}` : (account?.name ?? preview.accountName ?? "Account")}
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
