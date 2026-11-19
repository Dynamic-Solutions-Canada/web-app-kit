# web-app-kit

web-app-kit holds the React UI primitives the Dynamic Solutions web apps share once a piece has reached its third copy. It is built on Joy UI. Apps install it as a runtime dependency pinned to a git tag. It provides `BackAwareModal`, the dialog that browser and Android Back close instead of navigating the page away, with an opt-in lint rule that keeps every dialog on it; `EmptyState`, the one surface for a list or page with nothing to show; and `useResetOnChange`, which resets local state when a prop changes.

The kit holds no app names, strings or app behaviour. Where apps need different behaviour, the kit offers a general option, event or hook, and the policy stays in the app.

## Add web-app-kit to an app

```bash
npm install --save-exact github:Dynamic-Solutions-Canada/web-app-kit#vX.Y.Z
```

Pin a tag, and keep every app on the same tag. Changes reach apps only through a new tag.

The package is built from source when it installs: npm clones the tag, installs the kit's development dependencies and runs its `prepare` script, which compiles `dist/`. No build output is committed. npm 11 warns that the package's `prepare` script is not covered by `allowScripts`, so approve it once in the app, without a version pin:

```bash
npm install-scripts approve --no-allow-scripts-pin @dynamic-solutions-canada/web-app-kit
```

That writes `"github:Dynamic-Solutions-Canada/web-app-kit": true` to `allowScripts`, and it covers every later tag, so a bump needs no new approval. What npm 11.19.1 does with a git dependency, measured on a scratch app:

- **The build is not gated.** npm runs a git dependency's `prepare` while it fetches the package, before `allowScripts` is consulted, so the kit builds with an approval, without one, and even with a denial. The approval only silences the warning, and keeps the install working if npm starts enforcing it.
- **Only a git-form key matches.** `@dynamic-solutions-canada/web-app-kit` and `@dynamic-solutions-canada/web-app-kit@X.Y.Z` are registry keys, which npm never matches against a git dependency; with either, the warning stays.
- **The warning appears only when npm resolves the tag afresh**, on the first install and on a tag bump. A reinstall from the lockfile and `npm ci` print nothing either way, so check a key on a bump, not on a reinstall.
- **The default pinned approval goes stale.** Without `--no-allow-scripts-pin`, `approve` writes `github:Dynamic-Solutions-Canada/web-app-kit#<commit>`, which stops matching at the next tag.

The tag in `dependencies` and the lockfile's commit already pin the code that runs, so the name-only key loses nothing.

Do not install with `--ignore-scripts` (for example `npm ci --ignore-scripts` in a Dockerfile): it is the one setting that does skip the kit's build, the package arrives without `dist/`, and the app's build cannot import it.

The app supplies the peer dependencies:

| Peer                 | Range                                                  |
| -------------------- | ------------------------------------------------------ |
| `react`, `react-dom` | `^18.3.1 \|\| ^19`                                     |
| `@mui/joy`           | `^5.0.0-beta.52`                                       |
| `eslint`             | `^9.24.0 \|\| ^10`, optional, only for the lint config |

## BackAwareModal

A drop-in replacement for Joy's `Modal`. It takes every `Modal` prop, plus two of its own: `dismissOnBackdropClick` and `suspended`.

```tsx
import { ModalClose, ModalDialog } from '@mui/joy'
import { BackAwareModal } from '@dynamic-solutions-canada/web-app-kit'

export function RenameDialog({ open, onClose }: RenameDialogProps) {
  const { t } = useTranslation()
  return (
    <BackAwareModal open={open} onClose={onClose}>
      <ModalDialog>
        <ModalClose aria-label={t('dialog.close')} />
        {/* the dialog's content */}
      </ModalDialog>
    </BackAwareModal>
  )
}
```

What it does:

- **Back closes the top dialog.** Each open dialog owns one history entry. Back asks the top dialog to close, and the page stays where it is. Nested dialogs close one per Back.
- **Every close is a request.** The X, Escape, a button, and Back all reach `onClose`, and the dialog closes only if the app then sets `open` to false or unmounts it. A dialog that declines, for example to ask "Discard unsaved changes?", keeps its history entry, so the next Back still reaches it instead of leaving the page.
- **Scrim clicks do not close.** A click outside the dialog never reaches `onClose`. Set `dismissOnBackdropClick` only on a surface with nothing to lose, such as an image viewer.
- **Back is reported as `closeClick`**, the same reason as the X, because both ask for the same thing. `isBackGestureClose(event)` tells them apart for logging. Do not branch close behaviour on it.
- **Escape in an open Select or Menu** closes that popup only. The next Escape closes the dialog.
- **Focus** moves into the dialog when it opens and returns to the control that opened it when it closes (Joy's defaults, left on).
- **Scroll position** of the page underneath is kept across the dialog's history steps.
- **`suspended` hides a dialog without closing it**, for a surface that must briefly give way, such as a loading gate shown while the app's data refreshes. A suspended dialog keeps its history entry and its place in the stack, its children stay mounted so their state survives, and `hasOpenBackAwareDialog()` stays true. A Back while suspended asks the dialog to close, exactly as if it were showing. Pass `open={open} suspended={!dataReady}` rather than `open={open && dataReady}`, which would close the dialog and lose its state.

Closing by unmounting (`{open && <Dialog />}`) works too. If a route change unmounts an open dialog, the kit leaves history alone, so the navigation is not undone.

### How the history entries work

Chrome skips history entries that a page adds without a user activation: its Back button jumps over every entry of that page, and on Android, in a tab with nothing behind the page, Back closes the tab. After a Back button press Chrome also stops counting the page's earlier taps until the next one. So the kit never adds an entry in answer to Back:

- Each dialog opened from a tap or key press pushes its own entry and one spare entry above it, then steps back onto its own. This makes one extra history step, and so one extra `popstate`, whenever a dialog opens.
- When Back goes past a dialog, the kit returns to the dialog's entry by stepping forward to it, then asks the dialog to close. A declined Back adds nothing.
- A dialog opened in answer to Back, such as a "Discard changes?" prompt raised from `onClose`, claims the spare instead of pushing. When that prompt closes, its entry becomes the spare again, so the prompt can be raised and dismissed with Back any number of times.

The browser's Forward button can land on a spare or on a closed dialog's entry. The kit steps straight back off it, so Forward does nothing visible.

Joy's `ModalClose` is an icon-only button with no accessible name. Give it an `aria-label` from the app's translations, as above. The kit renders no `ModalClose` of its own.

### Reacting to open dialogs

The kit exposes the dialog stack read-only, so an app can hang its own policy on it, such as holding an automatic update reload or letting a native Back handler defer to an open dialog.

| Export                                | Returns                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasOpenBackAwareDialog()`            | Whether any `BackAwareModal` is open                                                                                                                    |
| `hasPendingBackAwareDialog()`         | Whether a dialog is open or a closed dialog's history entry is still being removed. An app that opens dialogs on its own should wait while this is true |
| `subscribeBackAwareDialogs(listener)` | Calls `listener` when either answer may have changed; returns an unsubscribe function                                                                   |

```ts
import {
  hasOpenBackAwareDialog,
  subscribeBackAwareDialogs,
} from '@dynamic-solutions-canada/web-app-kit'

subscribeBackAwareDialogs(() => {
  setAppBusy('dialog-open', hasOpenBackAwareDialog())
})
```

A native Back handler (Capacitor's `backButton`, a desktop host's back message) calls `history.back()` when `hasOpenBackAwareDialog()` is true, and the dialog handles it as a Back.

## EmptyState

The surface for any list or page with nothing to show: an icon, a short title saying what is missing, one sentence on why or what to do, and an optional action, centred in a dashed card.

```tsx
import { Button } from '@mui/joy'
import InventoryRoundedIcon from '@mui/icons-material/InventoryRounded'
import { EmptyState } from '@dynamic-solutions-canada/web-app-kit'

export function NoItems({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={<InventoryRoundedIcon />}
      title={t('items.empty.title')}
      description={t('items.empty.description')}
      action={<Button onClick={onAdd}>{t('items.add')}</Button>}
    />
  )
}
```

| Prop          | Type        | Notes                                                                                 |
| ------------- | ----------- | ------------------------------------------------------------------------------------- |
| `icon`        | `ReactNode` | Decorative; the bubble around it is hidden from assistive technology                  |
| `title`       | `ReactNode` | What is missing, in a few words                                                       |
| `description` | `ReactNode` | One sentence on why, or what to do                                                    |
| `action`      | `ReactNode` | Optional, usually one button                                                          |
| `compact`     | `boolean`   | Tighter spacing, for an empty state inside a card or a short list                     |
| `sx`          | `SxProps`   | Extra styles for the root card, applied after the defaults; the array form also works |

Colours come from the Joy theme (`neutral.outlinedBorder`, `background.level1`, `primary.softBg`, `primary.softColor`, `primary.outlinedBorder`, `text.tertiary`), so it follows the light and dark schemes with no app tokens.

### Restyling every empty state

Each part carries a stable class name. These names are public API: renaming or removing one is a breaking change. `emptyStateClasses` exports them, so code need not spell them out.

| Part            | Class name                         | `emptyStateClasses` key |
| --------------- | ---------------------------------- | ----------------------- |
| The card        | `WebAppKit-EmptyState-root`        | `root`                  |
| The icon bubble | `WebAppKit-EmptyState-icon`        | `icon`                  |
| The title       | `WebAppKit-EmptyState-title`       | `title`                 |
| The description | `WebAppKit-EmptyState-description` | `description`           |

Restyle them once, where the app's theme lives, rather than passing `sx` at every use. Either route below wins over the kit's own styles:

```ts
import { extendTheme } from '@mui/joy'
import { emptyStateClasses } from '@dynamic-solutions-canada/web-app-kit'

// In the Joy theme: the override applies to the card, and nested selectors reach the parts.
const theme = extendTheme({
  components: {
    JoyCard: {
      styleOverrides: {
        root: {
          [`&.${emptyStateClasses.root}`]: {
            borderColor: 'var(--app-empty-state-border)',
            [`& .${emptyStateClasses.icon}`]: {
              backgroundColor: 'var(--app-empty-state-icon)',
            },
          },
        },
      },
    },
  },
})
```

In global CSS, use a selector with at least two classes, such as `.WebAppKit-EmptyState-root.WebAppKit-EmptyState-root` or `.app-shell .WebAppKit-EmptyState-root`. A rule with a single class has the same specificity as the kit's own styles and loses to them.

## Lint: dialogs use BackAwareModal

A dialog built directly on Joy's `Modal` looks identical and silently loses Back handling. The `./eslint` export makes a direct import an error.

If the app has no other `no-restricted-imports` rule, add the config object:

```js
// eslint.config.mjs
import { backAwareModalLintConfig } from '@dynamic-solutions-canada/web-app-kit/eslint'

export default [
  // ...the app's configs
  backAwareModalLintConfig,
]
```

ESLint does not merge this rule's options across config objects; a later object replaces an earlier one. If the app already restricts imports, spread the kit's paths into its own list instead:

```js
import { backAwareModalRestrictedImportPaths } from '@dynamic-solutions-canada/web-app-kit/eslint'

const restrictedImports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [...backAwareModalRestrictedImportPaths, ...appRestrictedPaths],
      },
    ],
  },
}
```

In an npm workspaces monorepo, the config must be able to resolve the kit from where the config file sits. `npm install -w apps/web <kit>` can install the kit under `apps/web/node_modules` rather than the root, and `npm dedupe` does not hoist it, so a root `eslint.config.mjs` then fails to import `@dynamic-solutions-canada/web-app-kit/eslint`. Either declare the kit in the root `package.json` as well, or import the lint config from a config file inside the workspace that declares it.

## Adopting it in an app

- Replace the app's own copy and its history helper; do not keep both. An app's old history key, left in a tab that stays open across the deploy, is ignored, and a stale entry costs at most one Back that does nothing.
- Move the app's "dialog is open" hookups (an app-busy registry, a native Back handler) onto the read-only stack exports above.
- Before shipping, check Back on a real device: Android's Back gesture and a desktop browser's Back button, on a dialog that closes, on one that declines twice in a row with no tap between, and on a prompt raised from `onClose`. Chrome's entry skipping only affects the real Back button; automated `goBack()` calls do not exercise it.
- `EmptyState` keeps the props of the copies it replaces, with `title` and `description` widened to any `ReactNode`. Move an app-specific look out of the component and into the app's theme through the class names above.
- Behaviour that may differ from an older copy of `BackAwareModal`: scrim clicks no longer close, Back arrives as `closeClick` rather than `backdropClick`, focus handling is on, and a declined close keeps the dialog's history entry.

## Limits and gotchas

- **One copy per page.** The dialog stack is module state. Two kit copies bundled into one page (two versions, or a kit copy beside an app's own history-backed modal) would each treat the other's history entries as stale and step back over them, so Back misbehaves. This is one reason every app pins the same tag; after an upgrade, check that only one copy is installed (`npm ls @dynamic-solutions-canada/web-app-kit`).
- **ES modules only, `require()` too.** The kit ships one ES module build. Node 22.12 and later load it with `require()` as well as `import`, and both return the same module, so a test that `require()`s the kit still shares one dialog stack. A loader that compiles modules on `require()` breaks that: under tsx 4.23, which `devkit-test` uses for TypeScript tests, a `require()`d kit (directly, or through a `require()`d file that imports it) is a second copy beside the `import`ed one. In one test file, reach the kit through `require()` everywhere or through `import` everywhere.
- **Node range.** The kit is developed on the Node version in `.nvmrc`, but `engines.node` is the range `>=22.22.2 <25`, so apps still on Node 22 can install it with `engine-strict=true`. This is a deliberate, temporary exception to the exact-pin rule for a shared library, as in devkit; it narrows to the exact fleet version once every app has moved to it. The lower bound comes from the build's own dependencies (jsdom 31).
- **React 18 support is temporary.** The peer range covers React 18 for the apps still on it, and the kit's tests run on both majors (`npm run test:react18`). The range narrows to `^19` once every app has upgraded.
- **Private repository, for now.** Installing a tag needs git access to this repo wherever the app installs: developer machines, the app's CI, and any image build. This goes away when the repo is made public.
- **Install cost.** Because the kit builds on install, the first install of a tag downloads its development dependencies. npm caches the result.
- **Back, and entries Chrome may skip.** The kit adds no entry in answer to Back (see [How the history entries work](#how-the-history-entries-work)), with three exceptions. Each one can make Chrome's Back skip the page until the user next taps it:
  - a third dialog opened in answer to Back, over a prompt that itself opened in answer to Back;
  - a dialog opened before the user has interacted with the page at all, such as an announcement on load;
  - a Back that jumps further than the page under the dialogs, for example from the history menu.
- **Development StrictMode.** A dialog's history entries are pushed one task after it opens, so React's StrictMode double mount leaves no extra entry.

## useResetOnChange

Resets local state when some values change, during render rather than in an effect. This is React's documented pattern for adjusting state when a prop changes. React applies the reset before the browser paints, so stale values never flash. An effect that calls a setter would flash for a frame, and `react-hooks/set-state-in-effect` rejects it.

```tsx
import { useState } from 'react'
import { useResetOnChange } from '@dynamic-solutions-canada/web-app-kit'

export function NameField({ savedName }: { savedName: string }) {
  const [draft, setDraft] = useState(savedName)
  useResetOnChange([savedName], () => {
    setDraft(savedName)
  })
  return (
    <input value={draft} onChange={(event) => setDraft(event.target.value)} />
  )
}
```

- `values` is compared with the previous render's by `Object.is`, like an effect's dependency list.
- `reset` is not called on the first render, so start each `useState` at the value a reset produces.
- `reset` runs during render, so it may only call this component's own state setters.

## Reading the latest value from an effect

An effect or a listener it registers often needs the latest prop or callback without re-subscribing whenever it changes. The kit does not export a helper for this:

- **React 19:** use React's `useEffectEvent`. Call the function it returns only from effects and the listeners they register; `react-hooks` 7 checks this.
- **React 18:** store the value in a ref from a layout effect, never during render, which `react-hooks/refs` rejects:

```ts
const onChangeRef = useRef(onChange)
useLayoutEffect(() => {
  onChangeRef.current = onChange
})
```

## Developers

- Commands, architecture and conventions for working on the kit: [AGENTS.md](AGENTS.md)
- Releasing a version: the [`release` skill](.agents/skills/release/SKILL.md)
- Security reports: [SECURITY.md](.github/SECURITY.md)

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Dynamic Solutions.
