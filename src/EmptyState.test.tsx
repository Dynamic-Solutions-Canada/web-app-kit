import assert from 'node:assert/strict'
import test, { after, afterEach, before } from 'node:test'
import type { JSDOM } from 'jsdom'
import { installJsdomGlobals } from './test-utils/jsdom.js'

// jsdom must exist before React DOM and Joy load, so everything below is imported late.
let dom: JSDOM
let testingLibrary: typeof import('@testing-library/react')
let kit: typeof import('./index.js')

before(async () => {
  dom = installJsdomGlobals()
  testingLibrary = await import('@testing-library/react')
  kit = await import('./index.js')
})

afterEach(() => {
  testingLibrary.cleanup()
})

after(() => {
  dom.window.close()
})

/** The rendered element carrying one of the public class names. */
function part(name: keyof typeof kit.emptyStateClasses): HTMLElement {
  const element = dom.window.document.querySelector<HTMLElement>(
    `.${kit.emptyStateClasses[name]}`,
  )
  assert.ok(element, `the ${name} part must render with its public class name`)
  return element
}

function renderEmptyState(
  props: Partial<import('./index.js').EmptyStateProps> = {},
) {
  return testingLibrary.render(
    <kit.EmptyState
      icon={<svg data-testid="icon" />}
      title="No printers yet"
      description="Add one to start."
      {...props}
    />,
  )
}

test('renders the title, the description and the action', () => {
  renderEmptyState({ action: <button type="button">Add the first one</button> })
  assert.equal(part('title').textContent, 'No printers yet')
  assert.equal(part('description').textContent, 'Add one to start.')
  const button = dom.window.document.querySelector('button')
  assert.equal(button?.textContent, 'Add the first one')
  assert.ok(part('root').contains(button), 'the action sits inside the card')
})

test('renders without an action', () => {
  renderEmptyState()
  assert.equal(dom.window.document.querySelector('button'), null)
})

test('accepts rich content for the title and description', () => {
  renderEmptyState({
    title: <span data-testid="rich-title">Nothing matches</span>,
    description: (
      <>
        Try <strong>another</strong> search.
      </>
    ),
  })
  assert.ok(part('title').querySelector('[data-testid="rich-title"]'))
  assert.equal(part('description').textContent, 'Try another search.')
})

test('the icon bubble is hidden from assistive technology', () => {
  renderEmptyState()
  const icon = part('icon')
  assert.equal(icon.getAttribute('aria-hidden'), 'true')
  assert.ok(icon.querySelector('[data-testid="icon"]'))
})

test('every public class name is on its part', () => {
  renderEmptyState()
  assert.deepEqual(Object.keys(kit.emptyStateClasses).sort(), [
    'description',
    'icon',
    'root',
    'title',
  ])
  for (const name of ['root', 'icon', 'title', 'description'] as const) {
    part(name)
  }
  assert.ok(part('root').contains(part('icon')))
})

test('compact tightens the icon and the title', () => {
  renderEmptyState()
  const regularWidth = dom.window.getComputedStyle(part('icon')).width
  const regularTitle = part('title').className
  testingLibrary.cleanup()

  renderEmptyState({ compact: true })
  const compactWidth = dom.window.getComputedStyle(part('icon')).width

  assert.equal(regularWidth, '52px')
  assert.equal(compactWidth, '44px')
  assert.notEqual(part('title').className, regularTitle, 'title level differs')
})

test('sx on the root is applied after the defaults', () => {
  renderEmptyState({ sx: { borderStyle: 'solid', maxWidth: 321 } })
  const style = dom.window.getComputedStyle(part('root'))
  assert.equal(style.maxWidth, '321px')
  assert.equal(
    style.borderStyle,
    'solid',
    'the caller overrides the dashed default',
  )
})

test('sx also accepts the array form', () => {
  renderEmptyState({ sx: [{ maxWidth: 200 }, { maxWidth: 222 }] })
  assert.equal(dom.window.getComputedStyle(part('root')).maxWidth, '222px')
})
