/**
 * DB-backed option lists (statuses, priorities, delivery types, ...).
 *
 * Replaces the hardcoded `const FOO_OPTIONS = [...]` arrays that used to live in
 * page files. Backed by `GET /masters/options/lookup?groups=a,b,c`; every group is
 * editable from the database / admin API -- nothing is defined in code.
 */

import { useEffect, useMemo, useState } from "react";
import { apiGet, toQueryString } from "./api";
import { useLookup } from "./lookups";

export interface OptionItem {
  id: string;
  value: string;
  label: string;
  sort_order: number;
  meta?: Record<string, any> | null;
}

export type OptionGroups = Record<string, OptionItem[]>;

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { items: OptionItem[]; timestamp: number }>();
const inFlight = new Map<string, Promise<OptionGroups>>();

export function invalidateOptionsCache(group?: string) {
  if (group) cache.delete(group);
  else cache.clear();
}

async function fetchGroups(groups: string[]): Promise<OptionGroups> {
  const now = Date.now();
  const result: OptionGroups = {};
  const missing: string[] = [];
  for (const g of groups) {
    const hit = cache.get(g);
    if (hit && now - hit.timestamp < CACHE_TTL_MS) result[g] = hit.items;
    else missing.push(g);
  }
  if (missing.length) {
    const key = [...missing].sort().join(",");
    let promise = inFlight.get(key);
    if (!promise) {
      promise = apiGet<OptionGroups>(`/masters/options/lookup${toQueryString({ groups: key })}`)
        .then(({ data }) => {
          const fetched = data || {};
          for (const g of missing) cache.set(g, { items: fetched[g] || [], timestamp: Date.now() });
          inFlight.delete(key);
          return fetched;
        })
        .catch((err) => {
          inFlight.delete(key);
          throw err;
        });
      inFlight.set(key, promise);
    }
    const fetched = await promise;
    for (const g of missing) result[g] = fetched[g] || [];
  }
  return result;
}

/** Load one or more option groups. `groups` should be a stable (module-level or memoized) array. */
export function useOptions(groups: readonly string[]): { options: OptionGroups; loaded: boolean } {
  const key = groups.join(",");
  const [options, setOptions] = useState<OptionGroups>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGroups(key ? key.split(",") : [])
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch(() => {
        /* dropdowns degrade to empty rather than falling back to hardcoded values */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return useMemo(() => ({ options, loaded }), [options, loaded]);
}

/** Convenience: the `value` strings of a group, in display order. */
export function optionValues(options: OptionGroups, group: string): string[] {
  return (options[group] || []).map((o) => o.value);
}

/** Convenience: value -> label lookup for a group. */
export function optionLabelMap(options: OptionGroups, group: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const o of options[group] || []) map[o.value] = o.label;
  return map;
}

/** Active `name` values of a master table (warehouses, payment terms, transports, ...), in display order. */
export function useMasterNames(apiBase: string, pageSize = 250): string[] {
  const { items } = useLookup<{ name?: string }>(apiBase, pageSize);
  return useMemo(() => items.map((i) => i.name).filter((n): n is string => Boolean(n)), [items]);
}
