/**
 * Keeps a dialog's own Select, Autocomplete and Menu popups working inside a Joy modal.
 *
 * Joy renders those popups in a portal under `body`, outside the modal's DOM. Two things
 * go wrong because of that, and both are fixed here rather than in each dialog:
 *
 * - Escape pressed in an open popup also bubbles to the modal, which would close the
 *   whole dialog. `isDialogPopupEvent` lets the popup spend that key first.
 * - After a nested modal closes, Joy's modal manager restores `aria-hidden` only on the
 *   surviving modal root, so a still-mounted listbox portal stays hidden from assistive
 *   technology. `useDialogPopupAccessibility` unhides listboxes owned by this dialog,
 *   following expanded controls inside its root, and never unhides background UI.
 */
import { useEffect } from 'react'

/** Splits an `aria-controls` value into the ids it names. */
function controlledIds(control: Element): string[] {
  const value = control.getAttribute('aria-controls') ?? ''
  return value.split(/\s+/).filter((id) => id.length > 0)
}

/**
 * Whether an event target sits in a popup (listbox or menu) owned by an expanded control
 * inside this dialog, or on that control itself.
 *
 * @param root The modal's root element, or null before it mounts.
 * @param target The event target to test.
 */
export function isDialogPopupEvent(
  root: HTMLElement | null,
  target: unknown,
): boolean {
  const ElementClass = root?.ownerDocument.defaultView?.Element
  if (!root || !ElementClass || !(target instanceof ElementClass)) {
    return false
  }

  const controls = root.querySelectorAll('[aria-expanded="true"][aria-controls]')
  for (const control of controls) {
    for (const id of controlledIds(control)) {
      const popup = root.ownerDocument.getElementById(id)
      if (!popup) {
        continue
      }
      const role = popup.getAttribute('role') ?? ''
      if (!['listbox', 'menu'].includes(role)) {
        continue
      }
      if (popup.contains(target) || control.contains(target)) {
        return true
      }
    }
  }
  return false
}

/**
 * Keeps listbox portals owned by an open dialog in the accessibility tree.
 *
 * @param root The modal's root element, or null before it mounts.
 * @param open Whether the dialog is open; the observer runs only while it is.
 */
export function useDialogPopupAccessibility(
  root: HTMLElement | null,
  open: boolean,
): void {
  useEffect(() => {
    const ObserverClass = root?.ownerDocument.defaultView?.MutationObserver
    if (!open || !root || !ObserverClass) {
      return
    }

    const restoreOwnedPopups = () => {
      // A dialog that is itself hidden behind another modal must not unhide anything.
      if (!root.isConnected || root.closest('[aria-hidden="true"]')) {
        return
      }
      const controls = root.querySelectorAll(
        '[role="combobox"][aria-expanded="true"][aria-controls]',
      )
      for (const control of controls) {
        for (const id of controlledIds(control)) {
          const popup = root.ownerDocument.getElementById(id)
          const isHiddenListbox =
            popup?.getAttribute('role') === 'listbox' &&
            popup.getAttribute('aria-hidden') === 'true'
          if (isHiddenListbox) {
            popup.removeAttribute('aria-hidden')
          }
        }
      }
    }

    const observer = new ObserverClass(restoreOwnedPopups)
    observer.observe(root.ownerDocument.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'aria-expanded', 'aria-controls'],
    })
    restoreOwnedPopups()
    return () => {
      observer.disconnect()
    }
  }, [root, open])
}
