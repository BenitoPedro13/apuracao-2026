"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// A sortable table (TanStack Table v9 + shadcn markup). Sorting only: filtering is a
// business rule and lives in the hooks. Missing values (undefined) always sort last, so a
// unit without data never ranks as if it had zero (invariant 6).

export interface DataColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Omit for an unsortable column; return undefined for "no data". */
  sortValue?: (row: T) => number | string | undefined;
  numeric?: boolean;
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
});

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const helper = createColumnHelper<typeof features, object>();

function toColumns<T extends object>(cols: readonly DataColumn<T>[]) {
  return helper.columns(
    cols.map((c) =>
      helper.accessor((row) => c.sortValue?.(row as T), {
        id: c.id,
        header: c.header,
        cell: (info) => c.cell(info.row.original as T),
        enableSorting: !!c.sortValue,
        sortUndefined: "last",
        // Text sorts as pt-BR readers expect ("Águas" next to "Aguaí").
        sortFn: c.numeric ? "basic" : (a, b, id) => collator.compare(String(a.getValue(id)), String(b.getValue(id))),
        sortDescFirst: !!c.numeric,
      }),
    ),
  );
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

export function DataTable<T extends object>({
  rows,
  columns,
  caption,
  rowId,
  initialSort = [],
  onRowClick,
  rowLabel,
}: {
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  caption: ReactNode;
  rowId: (row: T) => string;
  initialSort?: SortingState;
  /** Makes the first cell a button (keyboard reachable), e.g. "open this UF's municipalities". */
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
}) {
  const table = useTable({
    features,
    columns: toColumns(columns),
    data: rows as T[],
    getRowId: (row) => rowId(row as T),
    initialState: { sorting: initialSort },
  });

  return (
    // From sm up the table keeps its columns apart; on a phone it wraps instead of hiding them.
    <Table className="sm:min-w-[32rem]">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const col = columns.find((c) => c.id === header.column.id);
              const sorted = header.column.getIsSorted();
              const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
              return (
                <TableHead
                  key={header.id}
                  aria-sort={sorted ? ARIA_SORT[sorted] : header.column.getCanSort() ? "none" : undefined}
                  className={cn(col?.numeric && "text-right")}
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        col?.numeric && "flex-row-reverse",
                      )}
                    >
                      {col?.header}
                      <Icon aria-hidden className="size-3.5 opacity-70" />
                    </button>
                  ) : (
                    col?.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell, i) => {
              const col = columns.find((c) => c.id === cell.column.id);
              const content = col?.cell(row.original as T);
              const original = row.original as T;
              return (
                <TableCell key={cell.id} className={cn("whitespace-normal sm:whitespace-nowrap", col?.numeric && "text-right font-mono")}>
                  {i === 0 && onRowClick ? (
                    <button
                      type="button"
                      onClick={() => onRowClick(original)}
                      aria-label={rowLabel?.(original)}
                      className="rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {content}
                    </button>
                  ) : (
                    content
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
