import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useFinanceActions, useLedger, useShell } from "@/context/FinanceContext";
import { kindForMoneyIn } from "@/lib/categorizer";
import { addDays, formatDisplayDate, todayISO } from "@/lib/dates";
import { formatSignedMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Chip = "category" | "account" | "date";

function PreviewChip({
  capture,
  pressed,
  className,
  style,
  onPress,
  children,
}: {
  capture: boolean;
  pressed?: boolean;
  className?: string;
  style?: CSSProperties;
  onPress?: () => void;
  children: ReactNode;
}) {
  const tone = cn(className, pressed && "ring-2 ring-ring");
  if (!capture) {
    return (
      <Badge className={tone} style={style}>
        {children}
      </Badge>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3 py-1 text-sm font-medium",
        tone,
      )}
      style={style}
      aria-pressed={pressed}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

export function QuickAddBar({ variant = "desktop" }: { variant?: "desktop" | "capture" }) {
  const capture = variant === "capture";
  const { categories, accounts, transactions, merchantMemory, categoryById, accountById } = useLedger();
  const { settings } = useShell();
  const { quickAddRef, previewQuickAdd, addTransactionFromQuickAdd } = useFinanceActions();
  const [value, setValue] = useState("");
  const [activeChip, setActiveChip] = useState<Chip | null>(null);
  const [categoryOverride, setCategoryOverride] = useState<string | null>(null);
  const [accountOverride, setAccountOverride] = useState<string | null>(null);
  const [toAccountOverride, setToAccountOverride] = useState<string | null>(null);
  const [dateOverride, setDateOverride] = useState<string | null>(null);

  const preview = useMemo(
    () => previewQuickAdd(value),
    [accounts, categories, merchantMemory, previewQuickAdd, settings.defaultAccountId, transactions, value],
  );
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
  const showPreview = Boolean(
    value && preview.amountCents && preview.kind && date && (preview.valid || (isTransfer && preview.accountId)),
  );
  const destinations = usableAccounts.filter((item) => item.id !== accountId);
  const accountChoices = isTransfer ? destinations : usableAccounts;

  useEffect(() => {
    setCategoryOverride(null);
    setAccountOverride(null);
    setToAccountOverride(null);
    setDateOverride(null);
    setActiveChip(null);
  }, [value]);

  function commit(raw = value) {
    const result = addTransactionFromQuickAdd(raw, {
      categoryId: !isTransfer && categoryOverride ? categoryOverride : undefined,
      accountId: !isTransfer && accountOverride ? accountOverride : undefined,
      toAccountId: isTransfer && toAccountOverride ? toAccountOverride : undefined,
      date: dateOverride ?? undefined,
    });
    if (!result.ok) return;

    setValue("");
    setCategoryOverride(null);
    setAccountOverride(null);
    setToAccountOverride(null);
    setDateOverride(null);
    setActiveChip(null);
    if (!capture) {
      requestAnimationFrame(() => quickAddRef.current?.focus());
    }
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

  function toggleChip(chip: Chip) {
    setActiveChip((current) => (current === chip ? null : chip));
  }

  function chooseAccount(id: string) {
    if (isTransfer) setToAccountOverride(id);
    else setAccountOverride(id);
    setActiveChip(null);
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
  const today = todayISO();
  const dateChoices = [
    { label: "Yesterday", value: addDays(today, -1) },
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
  ];

  return (
    <div className="shrink-0 border-b bg-card/90 px-5 py-4 backdrop-blur">
      <label className="sr-only" htmlFor="quick-add">
        Quick add
      </label>
      <Input
        id="quick-add"
        ref={quickAddRef}
        value={value}
        autoFocus={!capture}
        autoComplete="off"
        spellCheck={false}
        placeholder="12.50 Chipotle #cash  ·  +2500 Salary  ·  500 #cash -> #savings"
        className="h-12 border-input/80 bg-background text-base font-medium shadow-none"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={cn("mt-2 flex flex-wrap items-center gap-2 text-xs", capture ? "min-h-11" : "min-h-7")}>
        {!value && (
          <p className="text-muted-foreground">
            {capture
              ? "Type an amount and a name. Tap a chip to change it."
              : "Type an amount and a name, or 500 #cash to start a transfer. Tab edits chips."}
          </p>
        )}
        {value && !preview.valid && !(isTransfer && toAccountOverride) && (
          <p className="text-destructive">{preview.reason}</p>
        )}
        {showPreview && preview.amountCents && displayKind && date && (
          <>
            <Badge className={amountTone}>
              {formatSignedMoney(preview.amountCents, displayKind, settings.currency, settings.locale)}
            </Badge>
            {descriptionLabel && <Badge>{descriptionLabel}</Badge>}
            {!isTransfer && (
              <PreviewChip
                capture={capture}
                pressed={activeChip === "category"}
                className={cn(preview.categorySource !== "explicit" && !categoryOverride && "opacity-70")}
                style={category ? { borderColor: category.color, color: category.color } : undefined}
                onPress={() => toggleChip("category")}
              >
                {category?.name ?? "Uncategorized"}
              </PreviewChip>
            )}
            {displayKind === "refund" && <Badge className="border-income/30 text-income">Refund</Badge>}
            <PreviewChip
              capture={capture}
              pressed={activeChip === "account"}
              className={cn(isTransfer && preview.toAccountSource === "memory" && !toAccountOverride && "opacity-70")}
              onPress={() => toggleChip("account")}
            >
              {isTransfer ? `${fromLabel} → ${toAccount?.name ?? "…"}` : (account?.name ?? preview.accountName ?? "Account")}
            </PreviewChip>
            <PreviewChip
              capture={capture}
              pressed={activeChip === "date"}
              onPress={() => toggleChip("date")}
            >
              {formatDisplayDate(date, settings.locale)}
            </PreviewChip>
          </>
        )}
      </div>
      {capture && showPreview && activeChip === "category" && (
        <div className="mt-3 flex max-h-52 flex-col gap-1 overflow-y-auto">
          {usableCategories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex min-h-11 items-center rounded-md px-3 text-left text-sm",
                item.id === categoryId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
              onClick={() => {
                setCategoryOverride(item.id);
                setActiveChip(null);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      {capture && showPreview && activeChip === "account" && (
        <div className="mt-3 flex max-h-52 flex-col gap-1 overflow-y-auto">
          {accountChoices.length === 0 && (
            <p className="px-3 text-sm text-muted-foreground">No other account</p>
          )}
          {accountChoices.map((item) => {
            const selected = item.id === (isTransfer ? toAccountId : accountId);
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex min-h-11 items-center rounded-md px-3 text-left text-sm",
                  selected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
                onClick={() => chooseAccount(item.id)}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      )}
      {capture && showPreview && activeChip === "date" && date && (
        <div className="mt-3 flex flex-col gap-1">
          {dateChoices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              className={cn(
                "flex min-h-11 items-center justify-between rounded-md px-3 text-left text-sm",
                choice.value === date ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
              onClick={() => {
                setDateOverride(choice.value);
                setActiveChip(null);
              }}
            >
              <span>{choice.label}</span>
              <span className="text-muted-foreground">{formatDisplayDate(choice.value, settings.locale)}</span>
            </button>
          ))}
          <label className="flex min-h-11 items-center gap-3 px-3 text-sm">
            <span className="text-muted-foreground">Date</span>
            <input
              type="date"
              value={date}
              className="min-h-11 flex-1 bg-transparent"
              onChange={(event) => {
                if (!event.target.value) return;
                setDateOverride(event.target.value);
                setActiveChip(null);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
