# web-app-kit

web-app-kit holds the React UI primitives the Dynamic Solutions web apps share once a piece has reached its third copy. It is built on Joy UI. Apps install it as a runtime dependency pinned to a git tag. It provides `BackAwareModal`, the dialog that browser and Android Back close instead of navigating the page away, with an opt-in lint rule that keeps every dialog on it, and `EmptyState`, the one surface for a list or page with nothing to show.

The kit holds no app names, strings or app behaviour. Where apps need different behaviour, the kit offers a general option, event or hook, and the policy stays in the app.

## Add web-app-kit to an app

```bash
npm install --save-exact github:Dynamic-Solutions-Canada/web-app-kit#vX.Y.Z
```

Pin a tag, and keep every app on the same tag. Changes reach apps only through a new tag.

The package is built from source when it installs: npm clones the tag, installs the kit's development dependencies and runs its `prepare` script, which compiles `dist/`. No build output is committed. npm 11 then lists the package as having an unreviewed install script, so approve it once in the app:

```bash
npm install-scripts approve @dynamic-solutions-canada/web-app-kit@X.Y.Z
```

Do not install with `--ignore-scripts` (for example `npm ci --ignore-scripts` in a Dockerfile): it also skips the kit's build, the package arrives without `dist/`, and the app's build cannot import it. Under npm 11, `allowScripts` already decides which install scripts run.

The approval key includes the version, so a tag bump approves the new version in the same commit. With npm 11.19.1 the build runs whether or not the script is approved. Approve it rather than deny it, so the install keeps working if npm starts enforcing approval for git dependencies.

The app supplies the peer dependencies:

| Peer                 | Range                                                  |
| -------------------- | ------------------------------------------------------ |
| `react`, `react-dom` | `^18.3.1 \|\| ^19`                                     |
| `@mui/joy`           | `^5.0.0-beta.52`                                       |
| `eslint`             | `^9.24.0 \|\| ^10`, optional, only for the lint config |

## BackAwareModal

A drop-in replacement for Joy's `Modal`. It takes every `Modal` prop, plus one of its own.

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

Closing by unmounting (`{open && <Dialog />}`) works too. If a route change unmounts an open dialog, the kit leaves history alone, so the navigation is not undone.

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

## Adopting it in an app

- Replace the app's own copy and its history helper; do not keep both. An app's old history key, left in a tab that stays open across the deploy, is ignored, and a stale entry costs at most one Back that does nothing.
- Move the app's "dialog is open" hookups (an app-busy registry, a native Back handler) onto the read-only stack exports above.
- Before shipping, check Back on a real device: Android's Back gesture and a desktop browser's Back button, on a dialog that closes and on one that declines to close. Chrome can skip history entries created without a user gesture, which automated tests do not exercise.
- `EmptyState` keeps the props of the copies it replaces, with `title` and `description` widened to any `ReactNode`. Move an app-specific look out of the component and into the app's theme through the class names above.
- Behaviour that may differ from an older copy of `BackAwareModal`: scrim clicks no longer close, Back arrives as `closeClick` rather than `backdropClick`, focus handling is on, and a declined close keeps the dialog's history entry.

## Limits and gotchas

- **One copy per page.** The dialog stack is module state. Two kit copies bundled into one page (two versions, or a kit copy beside an app's own history-backed modal) would each treat the other's history entries as stale and step back over them, so Back misbehaves. This is one reason every app pins the same tag; after an upgrade, check that only one copy is installed (`npm ls @dynamic-solutions-canada/web-app-kit`).
- **Node range.** The kit is developed on the Node version in `.nvmrc`, but `engines.node` is the range `>=22.22.2 <25`, so apps still on Node 22 can install it with `engine-strict=true`. This is a deliberate, temporary exception to the exact-pin rule for a shared library, as in devkit; it narrows to the exact fleet version once every app has moved to it. The lower bound comes from the build's own dependencies (jsdom 31).
- **React 18 support is temporary.** The peer range covers React 18 for the apps still on it, and the kit's tests run on both majors (`npm run test:react18`). The range narrows to `^19` once every app has upgraded.
- **Private repository, for now.** Installing a tag needs git access to this repo wherever the app installs: developer machines, the app's CI, and any image build. This goes away when the repo is made public.
- **Install cost.** Because the kit builds on install, the first install of a tag downloads its development dependencies. npm caches the result.
- **Development StrictMode.** A dialog's history entry is pushed one task after it opens, so React's StrictMode double mount leaves no extra entry.

## Developers

- Commands, architecture and conventions for working on the kit: [AGENTS.md](AGENTS.md)
- Releasing a version: the [`release` skill](.agents/skills/release/SKILL.md)
- Security reports: [SECURITY.md](.github/SECURITY.md)

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Dynamic Solutions.
