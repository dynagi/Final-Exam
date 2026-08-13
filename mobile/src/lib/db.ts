/**
 * Query helpers that make "we only see some of the rows" impossible.
 *
 * PostgREST caps every response at a server-side `max-rows` (1000 on
 * Supabase) and returns the truncated page silently — no error, no flag. A
 * question bank runs to thousands of rows in this app, so any screen that
 * renders the whole bank has to page through it instead of firing one
 * request and hoping.
 */
import { PostgrestError } from '@supabase/supabase-js';

/** Rows per request. Comfortably under Supabase's default max-rows. */
const PAGE_SIZE = 1000;

/** A Supabase query builder that can still be `.range()`d. */
interface RangeableQuery<T> {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;
}

/**
 * Read every row a query matches, one page at a time.
 *
 * `build()` must return a *fresh* query each call — Supabase builders are
 * single-use, so re-ranging a spent one throws.
 *
 * Errors are returned rather than swallowed: a screen that shows nothing
 * because RLS rejected the read should say so, not look like an empty bank.
 */
export async function fetchAll<T>(
  build: () => RangeableQuery<T>
): Promise<{ rows: T[]; error: PostgrestError | null }> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    const batch = data ?? [];
    rows.push(...batch);
    // A short page means we've reached the end.
    if (batch.length < PAGE_SIZE) return { rows, error: null };
    // Runaway guard: 50k rows is far past anything a bank should hold.
    if (rows.length >= PAGE_SIZE * 50) return { rows, error: null };
  }
}
