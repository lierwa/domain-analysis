import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ReactNode } from "react";
import type { PageMeta } from "../lib/api";

interface PaginationControlsProps {
  page: PageMeta;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function PaginationControls({ page, onPageChange, disabled = false }: PaginationControlsProps) {
  const pageNumbers = createPageWindow(page.page, page.totalPages);
  const canGoPrevious = page.hasPreviousPage && !disabled;
  const canGoNext = page.hasNextPage && !disabled;

  return (
    <nav
      className="flex flex-col gap-3 border-t border-line px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
      aria-label="Pagination"
    >
      <div className="text-xs text-muted">
        {page.total === 0
          ? "No results"
          : `Showing ${(page.page - 1) * page.pageSize + 1}-${Math.min(
              page.page * page.pageSize,
              page.total
            )} of ${page.total}`}
      </div>

      <div className="flex items-center justify-between gap-2 sm:hidden">
        <button
          type="button"
          disabled={!canGoPrevious}
          onClick={() => onPageChange(page.page - 1)}
          className="rounded border border-line px-3 py-2 disabled:opacity-40"
        >
          Previous
        </button>
        <div className="text-xs text-muted">
          Page {page.page} of {page.totalPages}
        </div>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => onPageChange(page.page + 1)}
          className="rounded border border-line px-3 py-2 disabled:opacity-40"
        >
          Next
        </button>
      </div>

      <div className="hidden items-center gap-1 sm:flex">
        <PageIconButton
          label="First page"
          disabled={!canGoPrevious}
          onClick={() => onPageChange(1)}
          icon={<ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
        />
        <PageIconButton
          label="Previous page"
          disabled={!canGoPrevious}
          onClick={() => onPageChange(page.page - 1)}
          icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
        />
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            disabled={disabled}
            onClick={() => onPageChange(pageNumber)}
            className={[
              "h-9 min-w-9 rounded border px-3 text-xs",
              pageNumber === page.page
                ? "border-ink bg-ink text-surface"
                : "border-line text-muted hover:text-ink"
            ].join(" ")}
            aria-current={pageNumber === page.page ? "page" : undefined}
          >
            {pageNumber}
          </button>
        ))}
        <PageIconButton
          label="Next page"
          disabled={!canGoNext}
          onClick={() => onPageChange(page.page + 1)}
          icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
        />
        <PageIconButton
          label="Last page"
          disabled={!canGoNext}
          onClick={() => onPageChange(page.totalPages)}
          icon={<ChevronsRight className="h-4 w-4" aria-hidden="true" />}
        />
      </div>
    </nav>
  );
}

function PageIconButton({
  label,
  disabled,
  onClick,
  icon
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded border border-line text-muted hover:text-ink disabled:opacity-40"
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function createPageWindow(currentPage: number, totalPages: number) {
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
