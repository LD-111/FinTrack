import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFinance } from "@/context/FinanceContext";
import { formatAccountLabel } from "@/lib/accounts";
import { currentYearMonth, formatDisplayDate } from "@/lib/dates";
import { formatSignedMoney, parseAmountToken } from "@/lib/money";
import { toMerchantKey } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

export function TransactionTable() {
  const {
    transactions,
    categories,
    accounts,
    settings,
    selectedMonth,
    setSelectedMonth,
    accountFilter,
    setAccountFilter,
    updateTransaction,
    deleteTransaction,
    categoryById,
    accountById,
  } = useFinance();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<{ id: string; field: "description" | "amount" | "date" } | null>(null);

  const usableAccounts = accounts.filter((account) => !account.isArchived);

  const rows = useMemo(() => {
    return transactions.filter((transaction) => {
      if (!showAll && !transaction.date.startsWith(selectedMonth)) return false;
      if (categoryFilter !== "all" && transaction.categoryId !== categoryFilter) return false;
      if (
        accountFilter !== "all" &&
        transaction.accountId !== accountFilter &&
        transaction.toAccountId !== accountFilter
      ) {
        return false;
      }
      if (search && !transaction.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [accountFilter, categoryFilter, search, selectedMonth, showAll, transactions]);

  async function saveAmount(transaction: Transaction, raw: string) {
    const cents = parseAmountToken(raw);
    if (cents === null || cents <= 0) return;
    await updateTransaction(transaction.id, { amountCents: cents });
  }

  async function saveDescription(transaction: Transaction, raw: string) {
    const description = raw.trim();
    if (!description) return;
    await updateTransaction(transaction.id, {
      description,
      merchantKey: toMerchantKey(description),
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <Input
          type="month"
          value={selectedMonth || currentYearMonth()}
          onChange={(event) => {
            setShowAll(false);
            setSelectedMonth(event.target.value || currentYearMonth());
          }}
          className="w-40"
        />
        <Button
          variant={showAll ? "default" : "outline"}
          size="sm"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "This month" : "All time"}
        </Button>
        <select
          value={accountFilter}
          onChange={(event) => setAccountFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="all">All accounts</option>
          {usableAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          className="w-48"
        />
        <p className="ml-auto text-xs text-muted-foreground">{rows.length} rows</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">
            Type <span className="font-medium text-foreground">12.50 Chipotle</span> above to add your first expense.
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-36">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-40">Account</TableHead>
                <TableHead className="w-44">Category</TableHead>
                <TableHead className="w-36 text-right">Amount</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((transaction) => {
                const category = categoryById(transaction.categoryId);
                const isTransfer = transaction.kind === "transfer";
                return (
                  <TableRow key={transaction.id}>
                    <TableCell
                      onClick={() => setEditing({ id: transaction.id, field: "date" })}
                      className="cursor-text"
                    >
                      {editing?.id === transaction.id && editing.field === "date" ? (
                        <Input
                          type="date"
                          defaultValue={transaction.date}
                          autoFocus
                          className="h-8"
                          onBlur={(event) => {
                            if (event.target.value) {
                              void updateTransaction(transaction.id, { date: event.target.value });
                            }
                            setEditing(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        formatDisplayDate(transaction.date, settings.locale)
                      )}
                    </TableCell>
                    <TableCell
                      onClick={() => setEditing({ id: transaction.id, field: "description" })}
                      className="cursor-text font-medium"
                    >
                      {editing?.id === transaction.id && editing.field === "description" ? (
                        <Input
                          defaultValue={transaction.description}
                          autoFocus
                          className="h-8"
                          onBlur={(event) => {
                            void saveDescription(transaction, event.target.value);
                            setEditing(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        transaction.description
                      )}
                    </TableCell>
                    <TableCell>
                      {isTransfer ? (
                        <span className="text-sm text-muted-foreground">
                          {formatAccountLabel(transaction, accountById)}
                        </span>
                      ) : (
                        <select
                          value={transaction.accountId}
                          onChange={(event) => {
                            void updateTransaction(transaction.id, { accountId: event.target.value });
                          }}
                          className="h-8 w-full rounded-md border-0 bg-transparent text-sm"
                        >
                          {usableAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </TableCell>
                    <TableCell>
                      {isTransfer ? (
                        <span className="text-sm text-muted-foreground">Transfer</span>
                      ) : (
                        <select
                          value={transaction.categoryId}
                          onChange={(event) => {
                            void updateTransaction(transaction.id, { categoryId: event.target.value });
                          }}
                          className="h-8 w-full rounded-md border-0 bg-transparent text-sm"
                          style={{ color: category?.color }}
                        >
                          {categories
                            .filter((item) => !item.isArchived)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </TableCell>
                    <TableCell
                      onClick={() => setEditing({ id: transaction.id, field: "amount" })}
                      className="cursor-text text-right font-medium tabular-nums"
                    >
                      {editing?.id === transaction.id && editing.field === "amount" ? (
                        <Input
                          defaultValue={(transaction.amountCents / 100).toFixed(2)}
                          autoFocus
                          className="h-8 text-right"
                          onBlur={(event) => {
                            void saveAmount(transaction, event.target.value);
                            setEditing(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        <span
                          className={
                            transaction.kind === "expense"
                              ? "text-expense"
                              : transaction.kind === "income" || transaction.kind === "refund"
                                ? "text-income"
                                : "text-muted-foreground"
                          }
                        >
                          {formatSignedMoney(
                            transaction.amountCents,
                            transaction.kind,
                            settings.currency,
                            settings.locale,
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${transaction.description}`}
                        onClick={() => void deleteTransaction(transaction.id)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
