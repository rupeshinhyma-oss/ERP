/**
 * Realtime Event & Data Layer Integration (Phase 8C, Sections 11-14).
 *
 * Integrates Inhyma's existing WebSocket live events (`lib/live/`) with
 * the new IndexedDB local cache and Sync Manager:
 *
 *   WebSocket event
 *         ↓
 *   event deduplication (EventDedupeCache)
 *         ↓
 *   cached record inspection (localCache.ts)
 *         ↓
 *   cache update or invalidation
 *         ↓
 *   React / UI notification
 *
 * Does NOT rewrite or replace the existing WebSocket connection; acts
 * as a non-destructive bridge.
 */

import type { LiveEvent } from "@/lib/live/liveEvent";
import { EventDedupeCache } from "@/lib/live/liveDedupe";
import { liveClient } from "@/lib/live/liveClient";
import {
  cacheRecord,
  evictCachedRecord,
  getCachedRecord,
  shouldApplyLiveEvent,
  type CachedRecord,
} from "./localCache";
import { syncManager } from "./sync";

const globalDedupeCache = new EventDedupeCache(500);

let unsubEvent: (() => void) | null = null;
let unsubConn: (() => void) | null = null;

export type CacheAction = "IGNORED_DUPLICATE" | "IGNORED_STALE" | "IGNORED_NOT_CACHED" | "UPDATED" | "EVICTED";

export interface LiveCacheIntegrationResult {
  action: CacheAction;
  event: LiveEvent;
  record?: CachedRecord;
}

/**
 * Handle an incoming LiveEvent from the WebSocket feed:
 * 1. Deduplicates the event via `EventDedupeCache`.
 * 2. Checks whether the affected entity record is currently cached in IndexedDB.
 * 3. If cached:
 *    - For `*.deleted`: evicts the cached record.
 *    - For `*.updated`: applies changes if version is newer, or invalidates cache.
 *    - If stale version: safely ignores.
 * 4. If not cached: ignores without polluting cache.
 */
export async function handleLiveEventForCache(event: LiveEvent): Promise<LiveCacheIntegrationResult> {
  // 1. Deduplicate
  if (globalDedupeCache.isDuplicate(event.event_id)) {
    return { action: "IGNORED_DUPLICATE", event };
  }

  // 2. Check if cached
  const cached = await getCachedRecord(event.entity, event.entity_id);
  if (!cached) {
    return { action: "IGNORED_NOT_CACHED", event };
  }

  // 3. Handle deletions
  if (event.event_type.endsWith(".deleted")) {
    await evictCachedRecord(event.entity, event.entity_id);
    return { action: "EVICTED", event };
  }

  // 4. Handle updates
  if (event.event_type.endsWith(".updated")) {
    const isNewer = shouldApplyLiveEvent(cached, {
      entity: event.entity,
      entityId: event.entity_id,
      version: event.version,
      timestamp: event.timestamp,
    });

    if (!isNewer) {
      return { action: "IGNORED_STALE", event, record: cached };
    }

    // Merge changes with existing cached data
    const existingData = (typeof cached.data === "object" && cached.data !== null ? cached.data : {}) as Record<
      string,
      unknown
    >;
    const updatedData = {
      ...existingData,
      ...event.changes,
      version: event.version ?? existingData.version,
    };

    const updatedRecord = await cacheRecord({
      entity: event.entity,
      entityId: event.entity_id,
      version: event.version,
      data: updatedData,
      updatedAt: event.timestamp,
      source: "LIVE_EVENT",
    });

    return { action: "UPDATED", event, record: updatedRecord };
  }

  return { action: "IGNORED_NOT_CACHED", event };
}

/**
 * Reconnect callback: when WebSocket recovers connection, trigger SyncManager
 * to flush any pending offline mutations and reconcile state.
 */
export function onLiveReconnect(): void {
  void syncManager.triggerSync();
}

/**
 * Start listening to liveClient domain events and connection state transitions.
 * Automatically registered during `initDataLayer()`.
 */
export function startLiveIntegration(): void {
  if (unsubEvent || unsubConn) return;

  unsubEvent = liveClient.onEvent((event) => {
    void handleLiveEventForCache(event);
  });

  unsubConn = liveClient.onConnectionChange((status) => {
    if (status === "connected") {
      onLiveReconnect();
    }
  });
}

/**
 * Teardown WebSocket listeners. Called during `shutdownDataLayer()`.
 */
export function stopLiveIntegration(): void {
  unsubEvent?.();
  unsubEvent = null;
  unsubConn?.();
  unsubConn = null;
}

