/**
 * The history-backed stack of open `BackAwareModal` dialogs.
 *
 * Every open dialog owns one history entry. The entries carry the stack of open dialog
 * tokens in `history.state`, so a `popstate` can tell which dialogs the user went Back
 * past. Back then becomes a close REQUEST to those dialogs, never a close by itself:
 * the kit returns to their entries first, and an entry is spent only when its dialog
 * actually closes. A dialog that declines (an unsaved-changes prompt, a busy state)
 * therefore keeps its entry, and the next Back still reaches it instead of leaving the
 * page.
 *
 * Chromium's history manipulation intervention shapes how entries are made. When a page
 * adds an entry without a user activation, Chromium marks every entry of that document
 * as skippable, and its Back button then jumps over all of them (on Android, closing a
 * tab that has nothing else behind it). After a Back button press it also stops counting
 * the page's earlier activation until the next tap or key press. So the kit never adds
 * an entry in answer to Back:
 * - it returns to a dialog's entry by traversing forward to it, never by pushing a copy;
 * - each dialog opened from a gesture also pushes one spare entry above its own, and a
 *   dialog opened in answer to Back (a "Discard changes?" prompt) claims that spare by
 *   traversing onto it and rewriting it, which adds nothing.
 * Traversals and `replaceState` are exempt from the intervention.
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

/**
 * The last token of a spare entry's stack. It is never a dialog's token, so a spare that
 * nothing claimed reads as an entry to step off.
 */
const spareMarker = `${loadId}:spare`

interface ActiveDialog {
  token: string
  /** Asks the dialog to close, as Back does. The dialog may decline. */
  requestClose: () => void
}

interface ScrollPosition {
  x: number
  y: number
}

/**
 * What the traversal the kit started is for, acted on when its `popstate` lands.
 * - `step`: a plain step back (spending a closed dialog's entry, or off a stale one).
 * - `spare`: stepped back from a fresh spare onto the dialog entry under it.
 * - `claim`: stepped forward onto a spare, which now becomes `token`'s entry.
 * - `restore`: Back went past open dialogs and the kit returned to their entries; ask
 *   the dialogs above `depth` to close once there.
 */
type Landing =
  | { kind: 'step' }
  | { kind: 'spare' }
  | { kind: 'claim'; token: string }
  | { kind: 'restore'; depth: number }

/** A spare entry directly above the current entry, which holds `stack`. */
interface Spare {
  stack: string[]
  /** `history.length` when the spare was made; a push since then replaced it. */
  historyLength: number
}

let tokenCounter = 0
let listenerInstalled = false
let historyPopPending = false
let pendingLanding: Landing | null = null
let spare: Spare | null = null
let dialogEntryHref: string | null = null
let gestureSinceBack = false
let manualScrollRestorationDepth = 0
let previousScrollRestoration: History['scrollRestoration'] | null = null
const activeDialogs: ActiveDialog[] = []
const dismissedTokens = new Set<string>()
const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>()
/** Dialogs whose entry was due while one of the kit's steps was landing, oldest first. */
const deferredEntries: string[] = []
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
 * Whether a dialog is open or one of the kit's history steps is still landing.
 *
 * Closing a dialog calls `history.back()`, which lands a task or more later, and opening
 * one steps between its entry and its spare. Code that opens a dialog on its own (an
 * announcement, an onboarding prompt) should wait while this is true, or its entry would
 * be pushed in the middle of that step.
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

/** The open stack up to and including `token`, or null if that dialog is not open. */
function stackUpTo(token: string): string[] | null {
  const stack = activeStack()
  const index = stack.indexOf(token)
  if (index === -1) {
    return null
  }
  return stack.slice(0, index + 1)
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
  return token.startsWith(`${loadId}:`) && token !== spareMarker
}

function isSpareStack(stack: string[]): boolean {
  return stack[stack.length - 1] === spareMarker
}

function isTopOfHistory(token: string): boolean {
  const stack = readDialogStack(window.history.state)
  return stack[stack.length - 1] === token
}

/**
 * Starts one of the kit's own traversals, recorded so `hasPendingBackAwareDialog` covers
 * it and `popstate` knows it was not the user. Script traversals are not Back button
 * presses, so they leave Chromium's activation bookkeeping alone.
 *
 * @param delta Entries to move: negative is back, positive is forward.
 * @param landing What to do when it lands. Every kit step names one, so its landing is
 *   never mistaken for the user pressing Back.
 */
function traverse(delta: number, landing: Landing): void {
  historyPopPending = true
  pendingLanding = landing
  notifyListeners()
  window.history.go(delta)
}

/** `history.back()` as a kit traversal: spends an entry or steps off a stale one. */
function goBack(): void {
  traverse(-1, { kind: 'step' })
}

// ---------------------------------------------------------------------------------------
// User activation
// ---------------------------------------------------------------------------------------

/**
 * Notes a tap, click or key press, which Chromium counts as a user activation.
 *
 * The kit only needs one bit: has the user interacted since the last Back? Until they
 * have, Chromium treats a new entry as unrequested, so a dialog opened then claims a spare
 * instead of pushing. Escape is left out because it is not an activation.
 */
function noteGesture(event: Event): void {
  if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') {
    return
  }
  gestureSinceBack = true
}

const gestureEvents = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'touchend',
  'keydown',
] as const

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
 * A traversal the kit started finishes its job first (see `Landing`). Otherwise, by
 * comparing the stack in the new entry with the dialogs actually open:
 * - a spare nobody claimed (the user went Forward onto it): step back off it;
 * - the same stack: nothing to do;
 * - a prefix of the open stack: the user went Back past one or more dialogs, so the kit
 *   returns to their entries and then asks each to close, top first;
 * - anything else that names a dismissed or foreign token, or does not extend the open
 *   stack: a stale entry (Forward into a closed dialog, a leftover from a reload), which
 *   is rewritten to the open stack and stepped back over.
 */
function handlePopState(event: PopStateEvent): void {
  const landing = pendingLanding
  pendingLanding = null
  if (historyPopPending) {
    historyPopPending = false
    notifyListeners()
  } else {
    // Not the kit's own step, so the user pressed Back or Forward (or the app traversed).
    // Chromium stops counting the earlier activation from here until the next gesture.
    gestureSinceBack = false
  }

  try {
    routePopState(landing, readDialogStack(event.state))
  } finally {
    createDeferredEntries()
  }
}

/** The body of `handlePopState`: one traversal, sorted into the cases it describes. */
function routePopState(landing: Landing | null, nextStack: string[]): void {
  const currentStack = activeStack()

  if (landing?.kind === 'claim' && finishClaim(landing.token, nextStack)) {
    return
  }

  if (isSpareStack(nextStack)) {
    goBack()
    return
  }

  // The kit's own step landed where it was going. The open stack may already be longer,
  // when a dialog opened while the step was landing and its entry is still to come.
  if (landing && isStackPrefix(nextStack, currentStack)) {
    finishLanding(landing, nextStack)
    return
  }

  if (stacksEqual(nextStack, currentStack)) {
    return
  }

  if (isStackPrefix(nextStack, currentStack)) {
    returnToDialogs(nextStack.length, currentStack)
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
    window.history.replaceState(
      buildHistoryState(activeStack()),
      document.title,
    )
    if (window.history.length > 1) {
      goBack()
    }
  })
}

/**
 * The kit's step landed on the entry the open stack expects. Records a fresh spare, or
 * asks the dialogs a Back went past to close now that their entries are current again.
 */
function finishLanding(landing: Landing, stack: string[]): void {
  if (landing.kind === 'spare') {
    spare = { stack, historyLength: window.history.length }
    return
  }
  if (landing.kind === 'restore') {
    askDialogsAbove(landing.depth)
  }
}

/**
 * Gives each dialog that waited for a step to land its entry, oldest first, stopping
 * whenever one of them starts a step of its own; the next landing continues the queue.
 */
function createDeferredEntries(): void {
  while (!historyPopPending && deferredEntries.length > 0) {
    const token = deferredEntries.shift()
    if (token !== undefined) {
      createEntryFor(token)
    }
  }
}

/**
 * A claim landed. If it landed on the spare and the claiming dialog is still open, the
 * spare becomes that dialog's entry. Returns false when the entry is not a spare, so the
 * caller handles it like any other traversal.
 */
function finishClaim(token: string, nextStack: string[]): boolean {
  if (!isSpareStack(nextStack)) {
    // The spare had gone after all. Give the dialog its entry the ordinary way.
    pushEntryWithSpare(token)
    return true
  }
  const stack = stackUpTo(token)
  if (!stack) {
    // Closed while the step was landing: leave the spare, as Forward would find it.
    goBack()
    return true
  }
  window.history.replaceState(buildHistoryState(stack), document.title)
  return true
}

/**
 * Back went below the open dialogs from `depth` up: return to their entries, then ask.
 *
 * Their entries are still in the forward list, so the kit traverses to them rather than
 * pushing copies, which Chromium would count as unrequested entries (see the module
 * comment). The dialogs are asked once the step lands, so a dialog that accepts spends
 * its own entry in `closeDialog`, exactly as a close from the X does, and one that
 * declines simply keeps it.
 *
 * The kit can only be sure where those entries are when every open dialog has pushed and
 * Back landed directly under them. Otherwise (a dialog's push was still waiting, or Back
 * jumped further, such as from the history menu to another page) it falls back to
 * pushing the stack, which keeps the dialogs working but may let Chromium skip the page.
 */
function returnToDialogs(depth: number, currentStack: string[]): void {
  const landedUnderDialogs =
    depth > 0 || window.location.href === dialogEntryHref
  if (pendingPushes.size === 0 && landedUnderDialogs) {
    traverse(currentStack.length - depth, { kind: 'restore', depth })
    return
  }

  for (const timer of pendingPushes.values()) {
    clearTimeout(timer)
  }
  pendingPushes.clear()
  window.history.pushState(buildHistoryState(currentStack), document.title)
  askDialogsAbove(depth)
}

/** Asks the open dialogs above `depth` to close, top first, as a Back does. */
function askDialogsAbove(depth: number): void {
  const dialogsToAsk = activeDialogs.slice(depth).reverse()
  for (const dialog of dialogsToAsk) {
    dialog.requestClose()
  }
}

/**
 * Installs the shared listeners once, on the first dialog that opens.
 *
 * The entry the page is on may carry a stack from an earlier load (a reload with a dialog
 * open). With no dialog open yet, that stack is cleared, so the first dialog's Back lands
 * on a clean entry instead of a stale one that would step the page back a second time.
 *
 * The gesture listeners are passive and capture-phase, so they see every interaction
 * without delaying or changing any of them.
 */
function installListener(): void {
  if (listenerInstalled) {
    return
  }
  window.addEventListener('popstate', handlePopState)
  for (const type of gestureEvents) {
    window.addEventListener(type, noteGesture, { capture: true, passive: true })
  }
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
 * The entry waits one task. React StrictMode mounts, unmounts and remounts every
 * component in development; the unmount cancels the waiting entry, so the probe leaves
 * none. Re-registering an already open token only refreshes its close callback.
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
    createEntryFor(token)
  }, 0)
  pendingPushes.set(token, timer)

  restoreScrollPosition(scrollPosition)
}

/**
 * Gives an open dialog its history entry.
 *
 * With a gesture since the last Back, Chromium accepts new entries, so the dialog pushes
 * its own entry and a spare above it. Without one (the dialog opened in answer to Back,
 * or on its own), a push would let Chromium skip the page, so the dialog claims the spare
 * that the dialog under it left, if it is still there. With neither, it pushes anyway:
 * the dialog still works, and the user's next tap clears Chromium's mark.
 */
function createEntryFor(token: string): void {
  const stack = stackUpTo(token)
  if (!stack) {
    return
  }
  // A push now would land in the middle of the kit's own step; wait for it to land.
  if (historyPopPending) {
    deferredEntries.push(token)
    return
  }
  if (!gestureSinceBack && spareIsAbove(stack.slice(0, -1))) {
    spare = null
    traverse(1, { kind: 'claim', token })
    return
  }
  pushEntryWithSpare(token)
}

/** Whether a spare sits directly above the current entry, which must hold `stack`. */
function spareIsAbove(stack: string[]): boolean {
  if (!spare || stack.length === 0) {
    return false
  }
  return (
    stacksEqual(spare.stack, stack) &&
    stacksEqual(readDialogStack(window.history.state), stack) &&
    window.history.length === spare.historyLength
  )
}

/**
 * Pushes the dialog's entry and a spare above it, then steps back onto the dialog's own
 * entry. The step is a traversal, so it adds nothing; `popstate` records the spare when
 * it lands.
 */
function pushEntryWithSpare(token: string): void {
  const stack = stackUpTo(token)
  if (!stack) {
    return
  }
  if (stack.length === 1) {
    dialogEntryHref = window.location.href
  }
  spare = null
  window.history.pushState(buildHistoryState(stack), document.title)
  window.history.pushState(
    buildHistoryState([...stack, spareMarker]),
    document.title,
  )
  traverse(-1, { kind: 'spare' })
}

/** Removes a dialog from the stack. Returns false if it was not registered. */
function unregister(token: string): boolean {
  const pending = pendingPushes.get(token)
  if (pending !== undefined) {
    clearTimeout(pending)
    pendingPushes.delete(token)
  }
  dismissedTokens.add(token)
  const deferredIndex = deferredEntries.indexOf(token)
  if (deferredIndex !== -1) {
    deferredEntries.splice(deferredIndex, 1)
  }

  const index = activeDialogs.findIndex((dialog) => dialog.token === token)
  if (index === -1) {
    return false
  }
  activeDialogs.splice(index, 1)
  if (spare?.stack.includes(token)) {
    spare = null
  }
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
    spendTopEntry()
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
    spendTopEntry()
  }
}

/**
 * Steps back off the entry of a dialog that just closed.
 *
 * When the dialog sat on top of another that is still open, its entry is first rewritten
 * into a spare for that dialog, so a prompt the dialog below opens on the next Back can
 * claim it. Without this, a "Discard changes?" prompt dismissed with Back would leave no
 * spare for the second time Back raises it.
 */
function spendTopEntry(): void {
  const parentStack = readDialogStack(window.history.state).slice(0, -1)
  const parentStillOpen =
    parentStack.length > 0 && isStackPrefix(parentStack, activeStack())
  if (!parentStillOpen) {
    goBack()
    return
  }
  window.history.replaceState(
    buildHistoryState([...parentStack, spareMarker]),
    document.title,
  )
  traverse(-1, { kind: 'spare' })
}
