import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import { Modal } from '@mui/joy'
import { backGestureCloseEvent } from './backGesture.js'
import {
  closeDialog,
  createDialogToken,
  openDialog,
  releaseDialog,
} from './dialogStack.js'
import {
  isDialogPopupEvent,
  useDialogPopupAccessibility,
} from './dialogPopupAccessibility.js'

type JoyModalProps = ComponentProps<typeof Modal>
type JoyModalOnClose = NonNullable<JoyModalProps['onClose']>

/** Joy's `Modal` props, plus the one option this wrapper adds. */
export interface BackAwareModalProps extends JoyModalProps {
  /**
   * Let a click on the scrim dismiss this dialog. Off by default.
   *
   * A dialog closes only when the user aims at something that says it closes it: the X,
   * a button, Escape, or Back. A scrim click is none of those; it is what a misjudged
   * click at a dialog's edge produces, and the dialogs easiest to overshoot are the wide
   * ones that hold the most unsaved work.
   *
   * Opt in only where the surface holds nothing to lose and the scrim reads as "the thing
   * I am looking past", which in practice means an image viewer.
   */
  dismissOnBackdropClick?: boolean
}

/**
 * Joy's `Modal`, with browser and Android Back closing the top dialog instead of
 * navigating the page away.
 *
 * Each open dialog owns one history entry (see `dialogStack.ts`). Every close, whatever
 * the gesture, is a REQUEST passed to `onClose`, which the consumer may decline by
 * leaving `open` true; the entry is spent only when the dialog actually closes (`open`
 * becomes false, or the dialog unmounts without a navigation having moved on). So a
 * dialog that asks "Discard unsaved changes?" and is told "Keep editing" still closes on
 * the next Back.
 *
 * Dismissal is deliberate gestures only. A scrim click never reaches `onClose` unless
 * `dismissOnBackdropClick` is set. Back is reported with the reason `closeClick`, the same
 * as the X, because both ask for the same thing; `isBackGestureClose(event)` tells them
 * apart for diagnostics. Escape pressed in an open Select or Menu closes only that popup.
 *
 * Joy's focus handling is left on: focus moves into the dialog when it opens (so Escape
 * reaches it) and returns to the control that opened it when it closes.
 */
export function BackAwareModal({
  open,
  onClose,
  dismissOnBackdropClick = false,
  ...props
}: BackAwareModalProps) {
  const previousOpenRef = useRef(open)
  const onCloseRef = useRef(onClose)
  const tokenRef = useRef<string | null>(null)
  const [modalRoot, setModalRoot] = useState<HTMLDivElement | null>(null)

  // The latest onClose, for the history listener and Joy's close handler. Stored after
  // commit, never during render (which `react-hooks/refs` forbids); both callers run later.
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })

  /** Back went past this dialog: ask it to close, with the Back marker on the event. */
  const requestCloseFromBack = useCallback(() => {
    onCloseRef.current?.(backGestureCloseEvent(), 'closeClick')
  }, [])

  // Register while open. A token survives re-renders and is replaced after a close.
  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return
    }
    const token = tokenRef.current ?? createDialogToken()
    tokenRef.current = token
    openDialog(token, requestCloseFromBack)
  }, [open, requestCloseFromBack])

  // open went from true to false: the consumer accepted a close, so spend the entry.
  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open
    if (open || !wasOpen || typeof window === 'undefined') {
      return
    }
    const token = tokenRef.current
    if (token) {
      tokenRef.current = null
      closeDialog(token)
    }
  }, [open])

  // Unmounted while open: closed by unmounting, or removed by a route change. The stack
  // spends the entry only in the first case (see `releaseDialog`).
  useEffect(() => {
    return () => {
      const token = tokenRef.current
      if (token) {
        tokenRef.current = null
        releaseDialog(token)
      }
    }
  }, [])

  /**
   * Joy's close request, filtered to the deliberate gestures and handed to the consumer.
   *
   * History is not touched here: the consumer may decline, and only the `open` change
   * that follows an accepted close knows the dialog really closed.
   */
  const handleClose = useCallback<JoyModalOnClose>(
    (event, reason) => {
      // MUI removed `disableBackdropClick` in v5 and documents this check as its replacement.
      if (reason === 'backdropClick' && !dismissOnBackdropClick) {
        return
      }
      // Joy closes a Select's portal on Escape and also bubbles the key to the modal.
      // Let the popup spend this key; the next Escape closes the dialog.
      const target = 'target' in event ? event.target : null
      if (reason === 'escapeKeyDown' && isDialogPopupEvent(modalRoot, target)) {
        return
      }
      onCloseRef.current?.(event, reason)
    },
    [dismissOnBackdropClick, modalRoot],
  )

  useDialogPopupAccessibility(modalRoot, open)

  return <Modal ref={setModalRoot} open={open} onClose={handleClose} {...props} />
}
