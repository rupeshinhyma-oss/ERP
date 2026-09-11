/**
 * Local Entity Cache (Phase 2, Sections 9-10).
 *
 * Caches individual ERP records in IndexedDB with enough metadata
 * (entity, entity_id, version, updated_at, cached_at, source, sync
 * state) to answer two questions later:
 *
 * 1. "Do I already have this record, and is it still fresh enough to
 *    show without a network round trip?" (Section 9)
 * 2. "A `customer.updated version=8` event just arrived -- is that
 *    newer than what I have cached (version=7)?" (Section 10)
 *
 * The `entity`/`version` field names deliberately match
 * `lib/live/liveEvent.ts`'s `LiveEvent.entity` / `LiveEvent.version`
 * byte-for-byte (see `shouldApplyLiveEvent` below) -- a future phase
 * wiring this cache up to the live WebSocket feed can compare a
 * `LiveEvent` directly against a `CachedRecord` with no translation
 * layer in between, exactly the "prepare the infrastructure for it"
 * instruction in Section 10 (conflict resolution itself is explicitly
 * NOT implemented here, since the existing system has none to extend).
 *
 * This module does not decide WHAT is cacheable -- callers (a future
 * phase's per-module integration) choose what to call `cacheRecord`
 * with. Section 9 also asks not to cache sensitive data unnecessarily;
 * enforcing that is a per-module decision this generic cache cannot
 * make on their behalf, so it's called out here as the caller's
 * responsibility rather than silently assumed.
 */

import { dbDelete, dbGet, dbGetAllByIndex, dbPut } from "./db";
import { STORES } from "./schema";
import { getCurrentDbName } from "./context";

export type CacheSource = "SERVER_FETCH" | "OPTIMISTIC_LOCAL" | "LIVE_EVENT";

export interface CachedRecord<T = unknown> {
  cacheKey: string;
  entity: string;
  entityId: string;
  version: number | null;
  data: T;
  updatedAt: string | null;
  cachedAt: string;
  source: CacheSource;
}

export function buildCacheKey(entity: string, entityId: string): string {
  return `${entity}:${entityId}`;
}

export interface CacheRecordInput<T> {
  entity: string;
  entityId: string;
  version?: number | null;
  data: T;
  updatedAt?: string | null;
  source: CacheSource;
}

/** Store (or overwrite) one cached record. */
export async function cacheRecord<T>(input: CacheRecordInput<T>): Promise<CachedRecord<T>> {
  const record: CachedRecord<T> = {
    cacheKey: buildCacheKey(input.entity, input.entityId),
    entity: input.entity,
    entityId: input.entityId,
    version: input.version ?? null,
    data: input.data,
    updatedAt: input.updatedAt ?? null,
    cachedAt: new Date().toISOString(),
    source: input.source,
  };
  await dbPut(getCurrentDbName(), STORES.CACHED_RECORDS, record);
  return record;
}

export async function getCachedRecord<T>(entity: string, entityId: string): Promise<CachedRecord<T> | undefined> {
  return dbGet<CachedRecord<T>>(getCurrentDbName(), STORES.CACHED_RECORDS, buildCacheKey(entity, entityId));
}

export async function getCachedRecordsByEntity<T>(entity: string): Promise<CachedRecord<T>[]> {
  return dbGetAllByIndex<CachedRecord<T>>(getCurrentDbName(), STORES.CACHED_RECORDS, "entity", entity);
}

export async function evictCachedRecord(entity: string, entityId: string): Promise<void> {
  await dbDelete(getCurrentDbName(), STORES.CACHED_RECORDS, buildCacheKey(entity, entityId));
}

/**
 * Section 10's worked example, made concrete: given what's currently
 * cached for an entity (or `undefined` if nothing is cached yet) and an
 * incoming version number, decide whether the incoming data is actually
 * newer and should replace the cache.
 *
 * Entities with no version column (`incomingVersion === null`) always
 * "win" -- there is nothing to compare, so the newest write by cachedAt
 * order is trusted, matching how the rest of this ERP already treats
 * unversioned records elsewhere.
 */
export function isNewerVersion(cached: CachedRecord | undefined, incomingVersion: number | null): boolean {
  if (!cached) return true;
  if (incomingVersion === null || cached.version === null) return true;
  return incomingVersion > cached.version;
}

/**
 * The Section 10 seam for a future live-event integration: given a
 * `LiveEvent`-shaped object (imported by the CALLER from
 * `lib/live/liveEvent.ts` in a later phase -- this module takes a
 * structurally-compatible shape rather than importing that type
 * directly, so `lib/dataLayer` has no dependency on `lib/live`) and
 * what's currently cached, decide whether applying it would move the
 * cache forward.
 *
 * Deliberately does not itself CALL `cacheRecord` -- this only answers
 * "should I", leaving "how to turn this event into the entity's full
 * shape" to the future integration, since a live event's `changes`
 * payload is a partial diff, not necessarily the complete record this
 * cache stores.
 */
export function shouldApplyLiveEvent(
  cached: CachedRecord | undefined,
  incoming: { entity: string; entityId: string; version: number | null }
): boolean {
  if (!cached) return true;
  if (cached.entity !== incoming.entity || cached.entityId !== incoming.entityId) {
    throw new Error(
      `shouldApplyLiveEvent called with mismatched entity: cached=${cached.entity}:${cached.entityId}, incoming=${incoming.entity}:${incoming.entityId}`
    );
  }
  return isNewerVersion(cached, incoming.version);
}
