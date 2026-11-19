/**
 * Tells a browser or Android Back dismissal apart from the dialog's own close control.
 *
 * Joy reports both as `closeClick`, which is the right answer for behaviour: Back and the X
 * ask a dialog for the same thing. The marker exists only so diagnostics can name the
 * gesture that asked; consumers must not branch close policy on it.
 */
const backGestureCloseKey = '__webAppKitBackGestureClose'

/** The synthetic close event `BackAwareModal` passes to `onClose` for a Back gesture. */
export function backGestureCloseEvent(): Record<string, boolean> {
  return { [backGestureCloseKey]: true }
}

/**
 * Whether an `onClose` event came from a Back gesture rather than the X, Escape or a button.
 *
 * @param event The first argument `BackAwareModal` passed to `onClose`.
 */
export function isBackGestureClose(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) {
    return false
  }
  return (event as Record<string, unknown>)[backGestureCloseKey] === true
}
