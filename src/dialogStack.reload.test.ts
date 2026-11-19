import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import type { JSDOM } from 'jsdom'
import { installJsdomGlobals } from './test-utils/jsdom.js'

let dom: JSDOM

before(() => {
  dom = installJsdomGlobals()
})

after(() => {
  dom.window.close()
})

/** Waits out jsdom's timer-driven history traversal and the kit's one-task push delay. */
function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * A reload keeps `history.state` but starts the kit afresh, so the entry the page loads on
 * can name a dialog from the previous load. This file runs in its own process (one per
 * test file), so the stack module loads fresh here, as after a reload. The first dialog
 * it opens must clear that entry, and Back must close it.
 */
test("after a reload, a previous load's dialog entry does not break Back", async () => {
  dom.window.history.replaceState(
    { __webAppKitDialogStack: ['old-load:1'], usr: 1 },
    '',
  )
  const freshStack = await import('./dialogStack.js')

  let requests = 0
  const token = freshStack.createDialogToken()
  freshStack.openDialog(token, () => {
    requests += 1
    freshStack.closeDialog(token)
  })
  assert.deepEqual(
    freshStack.readDialogStack(dom.window.history.state),
    [],
    'the leftover stack is cleared when the first dialog opens',
  )
  await settle()

  dom.window.history.back()
  await settle()
  assert.equal(requests, 1, 'Back must ask the new dialog to close')
  assert.equal(freshStack.hasOpenBackAwareDialog(), false)
})
