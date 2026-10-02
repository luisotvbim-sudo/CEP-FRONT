import type { PowerUnlock } from './api'

export type UnlockWindow = { unlockedUntil: string; deadline: number }
// Use the server's duration and monotonic elapsed time, never the workstation's
// wall clock. Deduct the full request time to avoid extending the server window.
export function unlockWindow(
  result: PowerUnlock,
  requestedAt: number,
  receivedAt: number,
): UnlockWindow {
  return {
    unlockedUntil: result.unlockedUntil,
    deadline:
      receivedAt +
      Math.max(
        0,
        Date.parse(result.unlockedUntil) -
          Date.parse(result.serverTime) -
          (receivedAt - requestedAt),
      ),
  }
}
export function unlockRemaining(window: UnlockWindow, now: number) {
  return Math.max(0, Math.ceil((window.deadline - now) / 1000))
}
export function unlockTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
