/**
 * jsdom bootstrap for the kit's component tests, taken from the apps' shared helper.
 *
 * Call it before importing React DOM or Joy (Joy's popup code detects the DOM at import
 * time) and close the returned dom when the suite ends.
 */
import { JSDOM } from 'jsdom'

export function installJsdomGlobals(url = 'http://localhost/'): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  const { window } = dom

  // One set of DOM-owned timers, so closing the fixture cancels every pending frame.
  const requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.setTimeout(() => {
      callback(Date.now())
    }, 0)
  const cancelAnimationFrame = (handle: number) => {
    window.clearTimeout(handle)
  }
  Object.assign(window, { requestAnimationFrame, cancelAnimationFrame })

  const matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  })

  // Node 21+ defines `globalThis.navigator` as a getter with no setter, so assign by definition.
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true,
  })

  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    DocumentFragment: window.DocumentFragment,
    MutationObserver: window.MutationObserver,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    PopStateEvent: window.PopStateEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame,
    cancelAnimationFrame,
  })

  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  })
  // jsdom does not implement scrolling; the modal restores scroll on close.
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: () => {},
  })

  return dom
}
