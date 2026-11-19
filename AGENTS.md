# web-app-kit: Agent Instructions

web-app-kit is the shared React and Joy UI package for the Dynamic Solutions web apps. It holds UI primitives that have reached a third copy across the apps: `BackAwareModal` with its opt-in lint guard, `EmptyState`, and `useResetOnChange`. Apps install it as a runtime dependency pinned to a git tag; the tag's `prepare` script builds it on install. It is MIT licensed and builds on no other kit; devkit is a development dependency only.

## Standards

This repo follows the shared standards at https://github.com/Dynamic-Solutions-Canada/app-standards. Read the index for this stack, https://github.com/Dynamic-Solutions-Canada/app-standards/blob/main/stacks/kits.md, then the topic file for the area you are changing. If `external/standards/` exists, it is the same content pinned for offline use. Where this file differs from the standards, this file wins and says why. The rules that shape this kit most are KIT-7 (what moves in), KIT-8 (domain-neutral), KIT-10 (web code due to move), and REL-11 with KIT-6 (tags and pins).

## Architecture

web-app-kit owns shared web UI primitives and their lint guards. It does not own development tooling (devkit), app dialogs or frames built on its primitives, or any app's policy for reacting to them.

| Area                                                | Files                                 |
| --------------------------------------------------- | ------------------------------------- |
| Public API (`.` export)                             | `src/index.ts`                        |
| The modal component                                 | `src/BackAwareModal.tsx`              |
| History-backed dialog stack and its read-only API   | `src/dialogStack.ts`                  |
| Back-gesture marker on close events                 | `src/backGesture.ts`                  |
| Escape and accessibility fixes for in-dialog popups | `src/dialogPopupAccessibility.ts`     |
| Empty-state surface and its public class names      | `src/EmptyState.tsx`                  |
| Reset state during render when a prop changes       | `src/useResetOnChange.ts`             |
| Lint guard (`./eslint` export)                      | `src/eslint.ts`                       |
| Tests and the jsdom bootstrap                       | `src/*.test.ts(x)`, `src/test-utils/` |
| React 18 test pass                                  | `scripts/test-react18.mjs`            |

## Behaviour

- Every close is a request: the X, Escape, a button and Back all reach `onClose`, and a dialog's history entry is spent only when it actually closes. A change that pops history when a close is requested breaks dialogs that decline (an unsaved-changes prompt).
- Back returns to the entries it went past before asking the dialogs to close; a declined Back must leave the next Back working.
- Nothing the kit does in answer to Back may push a history entry. Chromium marks every entry of a page skippable when it adds one without a user activation, and ignores earlier activation after a Back button press. Return to an entry by traversing to it, and give a dialog opened after a Back the spare entry instead of a new one. A browser check of this reads the DevTools Audits `NavigationEntryMarkedSkippable` issue; `goBack()` alone cannot show it.
- `suspended` hides a dialog without closing it: the entry, the stack registration and the mounted children all stay.
- Unmounting spends the entry only while the current entry is still the dialog's own; after a route change, history is left alone so the navigation is not undone.
- Scrim clicks never reach `onClose` unless `dismissOnBackdropClick` is set.
- `emptyStateClasses` names are public API that apps style against; renaming or removing one, or moving one to a different part, is a breaking change. Default colours come only from Joy theme tokens.

## Conventions and gotchas

- A primitive moves in only at its third copy across the apps, under the name the apps already use, from the best copy. Two-copy code stays in the apps.
- Keep the kit domain-neutral: no app names, strings, settings or app behaviour, including in comments and test fixtures. When an app needs something different, add a general option, event or hook and keep the policy in the app.
- Every change reaches apps only when a version is tagged and each app bumps its pin, so a breaking change needs a major version (a minor below 1.0.0) and the app updates planned with it.
- Apps build the kit on install, so only what `files` in `package.json` lists reaches them, and every development dependency is installed in each app's install. Add development dependencies sparingly. An app that installs with `--ignore-scripts` gets no `dist/`.
- The dialog stack is module state and assumes one kit copy per page; do not add a second history listener or a second stack.
- Latest-callback refs are stored in `useLayoutEffect`, never during render, so the kit passes `react-hooks/refs` and apps can keep it as an error.
- The peer range admits React 18 until every app is on 19; keep code and types valid on both, which `npm run test:react18` checks.
- `engines.node` is a range, not an exact pin, so apps still on Node 22 can install with `engine-strict=true`. Its floor comes from the build's own dependencies (jsdom); raise it when they require it.
- Joy renders popups in portals outside the modal; DOM checks for "inside this dialog" go through `isDialogPopupEvent`, not `contains` on the modal root.
- The README is the canonical usage doc that apps link to; change behaviour and its README section together.

## Commands

| Command                | Proves                                                                 | Does not prove                                                                    |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run validate`     | Format, lint (React Compiler and a11y rules), typecheck and all tests  | Behaviour on React 18, in a real browser, or on a device's Back button            |
| `npm test`             | The jsdom tests pass on React 19 (`devkit-test` finds every test file) | Real browser history behaviour; jsdom traverses history on timers                 |
| `npm run test:react18` | Typecheck and tests on React 18; restores the locked versions after    | Anything about React 19                                                           |
| `npm run build`        | `dist/` compiles as apps will receive it                               | That an app's bundler and types accept it; install it into a scratch app for that |
| `npx lefthook install` | Run once per clone: installs the pre-commit check for secrets and size | Nothing about the code                                                            |

## Release

A `vX.Y.Z` tag runs `.github/workflows/release.yml`, which reruns the gate, checks the tag against `package.json` and `release-notes/<version>.md`, and creates the GitHub Release. The procedure is the `release` skill.

## Guidance map

| Guide, doc, or skill | Read or use when                          | Governs                                 |
| -------------------- | ----------------------------------------- | --------------------------------------- |
| `README.md`          | Changing any export, prop or install step | How apps install, use and adopt the kit |
| `release` skill      | Releasing a version                       | Notes, bump, tag and the Release        |

## Keeping docs current

| What changed                                | Update                         |
| ------------------------------------------- | ------------------------------ |
| An export, prop, peer range or install step | `README.md`                    |
| A file or area moved                        | The Architecture table above   |
| Anything a consuming app will notice        | The next `release-notes/` file |
