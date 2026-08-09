/**
 * Client-side pagination for the question lists.
 *
 * The bank is deliberately unbounded, so every screen that renders it needs
 * to show a page at a time rather than a thousand cards. The full filtered
 * array stays in memory (the rows are already fetched and small) — only the
 * slice handed to the list changes, which keeps selection state, counts and
 * validation working across page turns.
 */
import { useEffect, useMemo, useState } from 'react';

/** Page-size choices; 0 means "show everything on one page". */
export const PAGE_SIZES = [25, 50, 100, 0] as const;

export interface Pagination<T> {
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  pageCount: number;
  /** The rows to render for the current page. */
  pageItems: T[];
  /** 1-based index of the first row on this page (0 when empty). */
  from: number;
  /** 1-based index of the last row on this page. */
  to: number;
  total: number;
}

export function usePagination<T>(items: T[], initialSize = 25): Pagination<T> {
  const [pageSize, setPageSize] = useState<number>(initialSize);
  const [page, setPage] = useState(1);

  const total = items.length;
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));

  // Filtering can shrink the list under the current page — snap back rather
  // than showing an empty page the user cannot explain.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const start = pageSize === 0 ? 0 : (Math.min(page, pageCount) - 1) * pageSize;
  const pageItems = useMemo(
    () => (pageSize === 0 ? items : items.slice(start, start + pageSize)),
    [items, start, pageSize]
  );

  return {
    page: Math.min(page, pageCount),
    setPage: (p: number) => setPage(Math.max(1, Math.min(p, pageCount))),
    pageSize,
    setPageSize: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
    pageCount,
    pageItems,
    from: total === 0 ? 0 : start + 1,
    to: start + pageItems.length,
    total,
  };
}

/**
 * Page numbers to render: always the first and last, a window around the
 * current page, and `null` where a gap is elided.
 */
export function pageWindow(page: number, pageCount: number, span = 1): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const pages = new Set<number>([1, pageCount]);
  for (let p = page - span; p <= page + span; p++) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(null);
    out.push(p);
    previous = p;
  }
  return out;
}
