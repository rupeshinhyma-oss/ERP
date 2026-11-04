/**
 * LiveConnectionIndicator -- intentionally disabled per UI product specification.
 *
 * Background WebSocket live-event synchronization continues silently via
 * `LiveConnectionLifecycle` without displaying a bottom-left "Reconnecting" badge.
 */

export function LiveConnectionIndicator() {
  return null;
}
