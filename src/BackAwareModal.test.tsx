import assert from 'node:assert/strict'
import test, { after, afterEach, before } from 'node:test'
import type { JSDOM } from 'jsdom'
import type { ReactNode } from 'react'
import { installJsdomGlobals } from './test-utils/jsdom.js'

// jsdom must exist before React DOM and Joy load, so everything below is imported late.
let dom: JSDOM
let React: typeof import('react')
let Joy: typeof import('@mui/joy')
let testingLibrary: typeof import('@testing-library/react')
let kit: typeof import('./index.js')

before(async () => {
  dom = installJsdomGlobals()
  React = await import('react')
  Joy = await import('@mui/joy')
  testingLibrary = await import('@testing-library/react')
  kit = await import('./index.js')
})

afterEach(async () => {
  testingLibrary.cleanup()
  // Let any traversal a test started land, so the next test starts on a quiet history.
  await settle()
})

after(() => {
  dom.window.close()
})

/**
 * Waits out jsdom's history traversal. `history.back()` queues the traversal and its
 * `popstate` on timers, and the kit defers its own push by a task, so a promise tick is
 * not enough. A real timer is also what makes an assertion of ABSENCE meaningful: a close
 * that merely arrived late would otherwise pass.
 */
function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isModalMounted(): boolean {
  return dom.window.document.querySelector('.MuiModal-root') !== null
}

function query(selector: string): Element {
  const element = dom.window.document.querySelector(selector)
  assert.ok(
    element,
    `${selector} must be in the DOM for this test to mean anything`,
  )
  return element
}

function pressEscape(): void {
  query('.MuiModal-root').dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
}

function clickCloseButton(): void {
  query('.MuiModalClose-root').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true }),
  )
}

interface CloseRequest {
  reason: string
  fromBack: boolean
}

/**
 * A controlled dialog, the way apps use it: `onClose` records the request and closes
 * unless `decline()` says no, which is how an unsaved-changes prompt answers.
 */
function renderDialog(options: {
  decline?: () => boolean
  children?: ReactNode
  dismissOnBackdropClick?: boolean
  strict?: boolean
}) {
  const requests: CloseRequest[] = []
  const decline = options.decline ?? (() => false)

  function Harness() {
    const [open, setOpen] = React.useState(true)
    return (
      <kit.BackAwareModal
        open={open}
        dismissOnBackdropClick={options.dismissOnBackdropClick}
        onClose={(event, reason) => {
          requests.push({ reason, fromBack: kit.isBackGestureClose(event) })
          if (!decline()) {
            setOpen(false)
          }
        }}
      >
        <Joy.ModalDialog>
          <Joy.ModalClose aria-label="Close" />
          {options.children ?? 'dialog body'}
        </Joy.ModalDialog>
      </kit.BackAwareModal>
    )
  }

  const tree = options.strict ? (
    <React.StrictMode>
      <Harness />
    </React.StrictMode>
  ) : (
    <Harness />
  )
  testingLibrary.render(tree)
  return requests
}

test('Back closes the open dialog, reported as closeClick with the Back marker', async () => {
  const requests = renderDialog({})
  await settle()
  assert.ok(isModalMounted())

  dom.window.history.back()
  await settle()

  assert.deepEqual(requests, [{ reason: 'closeClick', fromBack: true }])
  assert.equal(
    isModalMounted(),
    false,
    'an accepted Back must close the dialog',
  )
  assert.equal(kit.hasOpenBackAwareDialog(), false)
})

test('the close reason reaches onClose unchanged and without a history hop', () => {
  const requests = renderDialog({ decline: () => true })
  pressEscape()
  assert.deepEqual(requests, [{ reason: 'escapeKeyDown', fromBack: false }])
})

test('an Escape the dialog declines leaves its history entry for Back', async () => {
  const requests = renderDialog({ decline: () => requests.length === 1 })
  await settle()

  pressEscape()
  dom.window.history.back()
  await settle()

  assert.deepEqual(requests, [
    { reason: 'escapeKeyDown', fromBack: false },
    { reason: 'closeClick', fromBack: true },
  ])
  assert.equal(isModalMounted(), false)
})

test('a Back the dialog declines keeps its entry, so the next Back still reaches it', async () => {
  const startLength = dom.window.history.length
  const requests = renderDialog({ decline: () => requests.length === 1 })
  await settle()

  dom.window.history.back()
  await settle()
  assert.ok(isModalMounted(), 'a declined Back must leave the dialog open')
  assert.equal(kit.hasOpenBackAwareDialog(), true)

  dom.window.history.back()
  await settle()

  assert.deepEqual(requests, [
    { reason: 'closeClick', fromBack: true },
    { reason: 'closeClick', fromBack: true },
  ])
  assert.equal(isModalMounted(), false, 'the second Back must close it')
  // The page itself must still be where it was: neither Back navigated past the dialog.
  assert.ok(dom.window.history.length >= startLength)
  assert.equal(dom.window.location.href, 'http://localhost/')
})

test('a dialog opened over a declined close does not re-ask the one below', async () => {
  const requests = renderDialog({ decline: () => true })
  await settle()
  clickCloseButton()
  assert.equal(requests.length, 1, 'the X must ask once')

  function Inner({ open }: { open: boolean }) {
    return (
      <kit.BackAwareModal open={open} onClose={() => {}}>
        <div>inner dialog</div>
      </kit.BackAwareModal>
    )
  }
  const inner = testingLibrary.render(<Inner open />)
  await settle()
  inner.rerender(<Inner open={false} />)
  await settle()

  assert.equal(
    requests.length,
    1,
    'closing the inner dialog must not re-ask the outer one',
  )
})

test('the close button closes the dialog by itself, exactly once', async () => {
  const requests = renderDialog({})
  await settle()
  clickCloseButton()
  await settle()

  assert.deepEqual(requests, [{ reason: 'closeClick', fromBack: false }])
  assert.equal(isModalMounted(), false)
})

// Two elements can be the scrim: Joy's backdrop slot, and `ModalOverflow`, which covers
// the backdrop entirely in a scrolling dialog and reports `backdropClick` itself.
const scrims = [
  {
    name: 'the backdrop slot',
    selector: '.MuiModal-backdrop',
    overflow: false,
  },
  {
    name: 'the ModalOverflow scroller',
    selector: '.MuiModalOverflow-root',
    overflow: true,
  },
]

function scrimBody(overflow: boolean): ReactNode {
  if (!overflow) {
    return undefined
  }
  return <Joy.ModalOverflow>scrolling body</Joy.ModalOverflow>
}

for (const scrim of scrims) {
  test(`a click on ${scrim.name} does not close a dialog`, async () => {
    const requests = renderDialog({ children: scrimBody(scrim.overflow) })
    // The handlers ignore bubbled clicks, so the event must start on the scrim itself.
    query(scrim.selector).dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    )
    await settle()
    assert.deepEqual(requests, [])
    assert.ok(isModalMounted())
  })

  test(`dismissOnBackdropClick lets ${scrim.name} close a dialog`, async () => {
    const requests = renderDialog({
      children: scrimBody(scrim.overflow),
      dismissOnBackdropClick: true,
    })
    query(scrim.selector).dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    )
    await settle()
    assert.deepEqual(requests, [{ reason: 'backdropClick', fromBack: false }])
  })
}

test('under StrictMode, opening pushes one entry and one Back closes the dialog', async () => {
  // Counted at the source: `history.length` also counts forward entries earlier tests left.
  const history = dom.window.history
  const originalPushState = history.pushState.bind(history)
  let pushes = 0
  history.pushState = (...args: Parameters<History['pushState']>) => {
    pushes += 1
    originalPushState(...args)
  }
  let requests: CloseRequest[]
  try {
    requests = renderDialog({ strict: true })
    await settle()
  } finally {
    history.pushState = originalPushState
  }
  // The StrictMode probe mounts, unmounts and remounts; only the remount may push.
  assert.equal(pushes, 1, 'exactly one entry per open dialog')

  dom.window.history.back()
  await settle()
  assert.deepEqual(requests, [{ reason: 'closeClick', fromBack: true }])
  assert.equal(isModalMounted(), false)
})

test('the read-only stack API follows open, close and the history step', async () => {
  let notifications = 0
  const unsubscribe = kit.subscribeBackAwareDialogs(() => {
    notifications += 1
  })
  try {
    renderDialog({})
    assert.equal(kit.hasOpenBackAwareDialog(), true)
    assert.equal(kit.hasPendingBackAwareDialog(), true)
    await settle()

    clickCloseButton()
    // Closed, but its entry is still being stepped back over.
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    assert.equal(kit.hasOpenBackAwareDialog(), false)

    await settle()
    assert.equal(
      kit.hasPendingBackAwareDialog(),
      false,
      'pending clears when the step lands',
    )
    assert.ok(
      notifications >= 3,
      `expected open, close and pop notifications, got ${notifications}`,
    )
  } finally {
    unsubscribe()
  }
})

/**
 * Apps that adopt the kit leave entries under their old key in tabs that stay open across
 * the deploy, and routers put their own keys in the same state. None of it may break Back.
 */
const foreignStates: { name: string; state: unknown }[] = [
  {
    name: "an app's old key",
    state: { __exampleAppDialogStack: ['dialog-1'], usr: 1 },
  },
  {
    name: 'a malformed stack',
    state: { __webAppKitDialogStack: 'not-a-list', usr: 1 },
  },
  {
    name: 'a non-string stack',
    state: { __webAppKitDialogStack: [1, 2], usr: 1 },
  },
  { name: 'a primitive', state: 'router-state' },
]

for (const { name, state } of foreignStates) {
  test(`a page entry holding ${name} does not break Back`, async () => {
    dom.window.history.replaceState(state, '')
    const requests = renderDialog({})
    await settle()

    dom.window.history.back()
    await settle()

    assert.deepEqual(requests, [{ reason: 'closeClick', fromBack: true }])
    assert.equal(isModalMounted(), false)
    const after: unknown = dom.window.history.state
    if (typeof state === 'object' && state !== null && 'usr' in state) {
      assert.equal(
        (after as { usr?: unknown } | null)?.usr,
        1,
        "the router's own keys survive",
      )
    }
  })
}

test('Escape inside an open listbox owned by the dialog closes only the popup', async () => {
  const requests = renderDialog({
    decline: () => true,
    children: (
      <div>
        <button
          type="button"
          aria-expanded="true"
          aria-controls="owned-listbox"
        >
          choose
        </button>
        <ul id="owned-listbox" role="listbox">
          <li role="option" aria-selected="false">
            one
          </li>
        </ul>
      </div>
    ),
  })
  query('#owned-listbox li').dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
  assert.deepEqual(requests, [], 'the popup spends the first Escape')
})

/**
 * Apps often close a dialog by unmounting it (`{open && <Dialog />}`) rather than by
 * setting `open` to false. That must spend the entry too, or the next Back does nothing.
 */
test('a dialog closed by unmounting spends its history entry', async () => {
  function Page({ show }: { show: boolean }) {
    return show ? (
      <kit.BackAwareModal open onClose={() => {}}>
        <div>conditionally mounted</div>
      </kit.BackAwareModal>
    ) : null
  }
  const page = testingLibrary.render(<Page show />)
  await settle()
  const stackWhileOpen = (
    dom.window.history.state as Record<string, unknown> | null
  )?.__webAppKitDialogStack
  assert.ok(Array.isArray(stackWhileOpen) && stackWhileOpen.length === 1)

  page.rerender(<Page show={false} />)
  await settle()

  const stackAfter = (
    dom.window.history.state as Record<string, unknown> | null
  )?.__webAppKitDialogStack
  assert.deepEqual(
    stackAfter ?? [],
    [],
    'the page must be back on an entry with no dialog',
  )
  assert.equal(kit.hasPendingBackAwareDialog(), false)
})

/** A route change that unmounts an open dialog must not be undone by the dialog's cleanup. */
test('a dialog unmounted by a navigation leaves the navigation in place', async () => {
  function Page({ show }: { show: boolean }) {
    return show ? (
      <kit.BackAwareModal open onClose={() => {}}>
        <div>on the old route</div>
      </kit.BackAwareModal>
    ) : null
  }
  const page = testingLibrary.render(<Page show />)
  await settle()

  // What a router does: push its own state for the new route, then re-render without the dialog.
  dom.window.history.pushState({ route: 'other' }, '', '/other')
  page.rerender(<Page show={false} />)
  await settle()

  assert.equal(dom.window.location.pathname, '/other')
  assert.deepEqual(dom.window.history.state, { route: 'other' })

  // Leave the next test on the original URL.
  dom.window.history.replaceState(null, '', '/')
})

test('with two dialogs open, each Back closes only the top one', async () => {
  const outer = renderDialog({})
  await settle()
  const inner = renderDialog({ children: 'inner dialog' })
  await settle()
  assert.equal(dom.window.document.querySelectorAll('.MuiModal-root').length, 2)

  dom.window.history.back()
  await settle()
  assert.deepEqual(inner, [{ reason: 'closeClick', fromBack: true }])
  assert.deepEqual(
    outer,
    [],
    'the first Back must not reach the dialog underneath',
  )
  assert.equal(dom.window.document.querySelectorAll('.MuiModal-root').length, 1)

  dom.window.history.back()
  await settle()
  assert.deepEqual(outer, [{ reason: 'closeClick', fromBack: true }])
  assert.equal(isModalMounted(), false)
  assert.equal(dom.window.location.href, 'http://localhost/')
})
