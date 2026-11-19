/**
 * The history-backed stack of open `BackAwareModal` dialogs.
 *
 * Every open dialog owns one history entry. The entries carry the stack of open dialog
 * tokens in `history.state`, so a `popstate` can tell which dialogs the user went Back
 * past. Back then becomes a close REQUEST to those dialogs, never a close by itself:
 * their entries are put back first, and an entry is spent only when its dialog actually
 * closes. A dialog that declines (an unsaved-changes prompt, a busy state) therefore keeps
 * its entry, and the next Back still reaches it instead of leaving the page.
 *
 * This module is the single owner of that state. It is deliberately free of React so the
 * component stays thin and the history rules can be read in one place. It also exposes a
 * read-only view (`hasOpenBackAwareDialog`, `hasPendingBackAwareDialog`,
 * `subscribeBackAwareDialogs`) so an app can hang its own policy on the stack: holding an
 * automatic update while a dialog is open, or letting a native Back handler defer to it.
 *
 * The state is module-level, so it assumes one copy of the kit per page. Two kit versions
 * bundled side by side would keep two stacks that cannot see each other.
 */

/** The key under which the open-dialog stack is stored in `history.state`. */
const stackStateKey = '__webAppKitDialogStack'

/**
 * Identifies this page load inside every token.
 *
 * `history.state` survives a reload, but the counter below does not, so without this a
 * token from the previous load could collide with a new one. Tokens from another load
 * are treated as stale. `Math.random` rather than `crypto.randomUUID`, because the latter
 * is missing outside secure contexts (a phone testing a LAN dev server over plain http).
 */
const loadId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

interface ActiveDialog {
  token: string
  /** Asks the dialog to close, as Back does. The dialog may decline. */
  requestClose: () => void
}

interface ScrollPosition {
  x: number
  y: number
}

let tokenCounter = 0
let listenerInstalled = false
let historyPopPending = false
let manualScrollRestorationDepth = 0
let previousScrollRestoration: History['scrollRestoration'] | null = null
const activeDialogs: ActiveDialog[] = []
const dismissedTokens = new Set<string>()
const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>()
const openScrollPositions = new Map<string, ScrollPosition>()
const listeners = new Set<() => void>()

// ---------------------------------------------------------------------------------------
// Public read-only view
// ---------------------------------------------------------------------------------------

/**
 * Whether any `BackAwareModal` is open right now.
 *
 * For code outside the React tree, such as a native Back handler that must let an open
 * dialog take Back first, or an update check that should wait while a dialog is open.
 */
export function hasOpenBackAwareDialog(): boolean {
  return activeDialogs.length > 0
}

/**
 * Whether a dialog is open or a closed dialog's history entry is still being removed.
 *
 * Closing a dialog calls `history.back()`, which lands a task or more later. Code that
 * opens a dialog on its own (an announcement, an onboarding prompt) should wait while
 * this is true, or its entry would be pushed on top of the one being removed.
 */
export function hasPendingBackAwareDialog(): boolean {
  return activeDialogs.length > 0 || historyPopPending
}

/**
 * Calls `listener` whenever either answer above may have changed.
 *
 * @returns A function that removes the listener.
 */
export function subscribeBackAwareDialogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(): void {
  // Copied, so a listener that unsubscribes while being called does not skip another.
  for (const listener of [...listeners]) {
    listener()
  }
}

// ---------------------------------------------------------------------------------------
// History state helpers
// ---------------------------------------------------------------------------------------

/**
 * Reads the dialog stack out of a history state.
 *
 * Any other shape (no state, another library's state, a malformed value, an app's old
 * key from before it adopted the kit) reads as an empty stack, so it can never throw.
 */
export function readDialogStack(state: unknown): string[] {
  if (state === null || typeof state !== 'object') {
    return []
  }
  const stack = (state as Record<string, unknown>)[stackStateKey]
  if (!Array.isArray(stack)) {
    return []
  }
  return stack.every((entry) => typeof entry === 'string') ? stack : []
}

/** The current history state with the dialog stack replaced, keeping the router's own keys. */
function buildHistoryState(stack: string[]): Record<string, unknown> {
  const current: unknown = window.history.state
  const base =
    current !== null && typeof current === 'object'
      ? (current as Record<string, unknown>)
      : {}
  return { ...base, [stackStateKey]: stack }
}

function activeStack(): string[] {
  return activeDialogs.map((dialog) => dialog.token)
}

function stacksEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((token, index) => token === right[index])
  )
}

function isStackPrefix(prefix: string[], full: string[]): boolean {
  return (
    prefix.length <= full.length &&
    prefix.every((token, index) => token === full[index])
  )
}

function isOwnToken(token: string): boolean {
  return token.startsWith(`${loadId}:`)
}

function isTopOfHistory(token: string): boolean {
  const stack = readDialogStack(window.history.state)
  return stack[stack.length - 1] === token
}

/** `history.back()`, recorded so `hasPendingBackAwareDialog` covers the traversal. */
function goBack(): void {
  historyPopPending = true
  notifyListeners()
  window.history.back()
}

// ---------------------------------------------------------------------------------------
// Scroll handling
// ---------------------------------------------------------------------------------------

/**
 * While a dialog is open the browser must not restore scroll on its own: the dialog's
 * history hops would otherwise jump the page underneath it. Nested dialogs share one
 * switch, counted by depth.
 */
function enableManualScrollRestoration(): void {
  if (manualScrollRestorationDepth === 0) {
    previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
  }
  manualScrollRestorationDepth += 1
}

function disableManualScrollRestoration(): void {
  if (manualScrollRestorationDepth === 0) {
    return
  }
  manualScrollRestorationDepth -= 1
  if (manualScrollRestorationDepth > 0) {
    return
  }
  if (previousScrollRestoration !== null) {
    window.history.scrollRestoration = previousScrollRestoration
    previousScrollRestoration = null
  }
}

function readScrollPosition(): ScrollPosition {
  return { x: window.scrollX, y: window.scrollY }
}

/** Restores scroll after layout settles; two frames, because Joy unlocks body scroll in one. */
function restoreScrollPosition(position: ScrollPosition | undefined): void {
  if (!position) {
    return
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ left: position.x, top: position.y, behavior: 'auto' })
    })
  })
}

// ---------------------------------------------------------------------------------------
// popstate
// ---------------------------------------------------------------------------------------

/**
 * Reacts to every history traversal while the kit is in use.
 *
 * Three cases, by comparing the stack in the new entry with the dialogs actually open:
 * - the same: nothing to do (the traversal was the kit's own, or unrelated);
 * - a prefix of the open stack: the user went Back past one or more dialogs, so their
 *   entries are restored and each is asked to close, top first;
 * - anything else that names a dismissed or foreign token, or does not extend the open
 *   stack: a stale entry (Forward into a closed dialog, a leftover from a reload), which
 *   is rewritten to the open stack and stepped back over.
 */
function handlePopState(event: PopStateEvent): void {
  if (historyPopPending) {
    historyPopPending = false
    notifyListeners()
  }

  const nextStack = readDialogStack(event.state)
  const currentStack = activeStack()

  if (stacksEqual(nextStack, currentStack)) {
    return
  }

  if (isStackPrefix(nextStack, currentStack)) {
    askDialogsAboveToClose(nextStack.length, currentStack)
    return
  }

  const namesStaleToken = nextStack.some(
    (token) => dismissedTokens.has(token) || !isOwnToken(token),
  )
  const isStale = namesStaleToken || !isStackPrefix(currentStack, nextStack)
  if (!isStale) {
    return
  }

  queueMicrotask(() => {
    window.history.replaceState(buildHistoryState(activeStack()), document.title)
    if (window.history.length > 1) {
      goBack()
    }
  })
}

/**
 * Back went below the open dialogs from `depth` up: restore their entries, then ask.
 *
 * The entries go back BEFORE anyone is asked, so a dialog that declines keeps one and a
 * dialog that accepts spends it in `closeDialog`, exactly as a close from the X does.
 */
function askDialogsAboveToClose(depth: number, currentStack: string[]): void {
  // The restore covers every open dialog, including any whose own push was still waiting.
  for (const timer of pendingPushes.values()) {
    clearTimeout(timer)
  }
  pendingPushes.clear()
  window.history.pushState(buildHistoryState(currentStack), document.title)

  const dialogsToAsk = activeDialogs.slice(depth).reverse()
  for (const dialog of dialogsToAsk) {
    dialog.requestClose()
  }
}

/**
 * Installs the shared `popstate` listener once, on the first dialog that opens.
 *
 * The entry the page is on may carry a stack from an earlier load (a reload with a dialog
 * open). With no dialog open yet, that stack is cleared, so the first dialog's Back lands
 * on a clean entry instead of a stale one that would step the page back a second time.
 */
function installListener(): void {
  if (listenerInstalled) {
    return
  }
  window.addEventListener('popstate', handlePopState)
  listenerInstalled = true

  const leftover = readDialogStack(window.history.state)
  if (leftover.length > 0 && activeDialogs.length === 0) {
    window.history.replaceState(buildHistoryState([]), document.title)
  }
}

// ---------------------------------------------------------------------------------------
// Lifecycle, called by BackAwareModal
// ---------------------------------------------------------------------------------------

/** A token unique to this dialog opening within this page load. */
export function createDialogToken(): string {
  tokenCounter += 1
  return `${loadId}:${tokenCounter}`
}

/**
 * Registers an opening dialog and schedules its history entry.
 *
 * The push waits one task. React StrictMode mounts, unmounts and remounts every component
 * in development; the unmount cancels the waiting push, so the probe leaves no entry.
 * Re-registering an already open token only refreshes its close callback.
 *
 * @param token From `createDialogToken`.
 * @param requestClose Asks the dialog to close as Back does; it may decline.
 */
export function openDialog(token: string, requestClose: () => void): void {
  installListener()

  const existing = activeDialogs.find((dialog) => dialog.token === token)
  if (existing) {
    existing.requestClose = requestClose
    return
  }

  const scrollPosition = readScrollPosition()
  openScrollPositions.set(token, scrollPosition)
  activeDialogs.push({ token, requestClose })
  enableManualScrollRestoration()
  notifyListeners()

  const timer = setTimeout(() => {
    pendingPushes.delete(token)
    pushEntryFor(token)
  }, 0)
  pendingPushes.set(token, timer)

  restoreScrollPosition(scrollPosition)
}

/** Pushes the stack up to and including `token`, if that dialog is still open. */
function pushEntryFor(token: string): void {
  const stack = activeStack()
  const index = stack.indexOf(token)
  if (index === -1) {
    return
  }
  window.history.pushState(
    buildHistoryState(stack.slice(0, index + 1)),
    document.title,
  )
}

/** Removes a dialog from the stack. Returns false if it was not registered. */
function unregister(token: string): boolean {
  const pending = pendingPushes.get(token)
  if (pending !== undefined) {
    clearTimeout(pending)
    pendingPushes.delete(token)
  }
  dismissedTokens.add(token)

  const index = activeDialogs.findIndex((dialog) => dialog.token === token)
  if (index === -1) {
    return false
  }
  activeDialogs.splice(index, 1)
  disableManualScrollRestoration()
  notifyListeners()
  return true
}

/**
 * A dialog closed (its `open` became false): spend its entry if it is on top.
 *
 * Stepping back is what keeps Back and Forward honest: a later Back navigates normally,
 * and Forward cannot land on the closed dialog's entry.
 */
export function closeDialog(token: string): void {
  const scrollPosition = openScrollPositions.get(token)
  openScrollPositions.delete(token)
  unregister(token)

  if (isTopOfHistory(token) && window.history.length > 1) {
    goBack()
    return
  }
  restoreScrollPosition(scrollPosition)
}

/**
 * A dialog unmounted while open: closed by unmounting (`{open && <Dialog />}`), or
 * removed because its route changed.
 *
 * The two are told apart by the current entry. If it is still this dialog's own, nothing
 * has navigated, so the entry is spent as on any close; otherwise a dead entry would make
 * the user's next Back do nothing. If a navigation has replaced it with the router's
 * state, history is left alone, because stepping back would undo that navigation; the
 * dialog's entry further down is then marked stale for `popstate`.
 */
export function releaseDialog(token: string): void {
  openScrollPositions.delete(token)
  unregister(token)

  if (isTopOfHistory(token) && window.history.length > 1) {
    goBack()
  }
}
