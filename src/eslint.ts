/**
 * Opt-in lint guard: dialogs mount `BackAwareModal`, never Joy's `Modal` directly.
 *
 * A dialog built on Joy's `Modal` renders identically, so nothing looks wrong until Back
 * navigates the page away from under it. This turns that into a lint error.
 *
 * ESLint's `no-restricted-imports` does not merge its options across config objects; a
 * later object replaces an earlier one. An app that already restricts other imports
 * should spread `backAwareModalRestrictedImportPaths` into its own `paths` list instead
 * of adding `backAwareModalLintConfig`.
 */

/** One entry of `no-restricted-imports`' `paths` option. */
export interface RestrictedImportPath {
  name: string
  importNames?: string[]
  message: string
}

/** The minimal flat-config shape this module produces, so ESLint stays an optional peer. */
export interface BackAwareModalLintConfig {
  name: string
  rules: {
    'no-restricted-imports': ['error', { paths: RestrictedImportPath[] }]
  }
}

const message =
  "Use BackAwareModal from '@dynamic-solutions-canada/web-app-kit' so Back closes the dialog instead of leaving the page."

/** The `paths` entries that block Joy's `Modal`, for combining with an app's own list. */
export const backAwareModalRestrictedImportPaths: RestrictedImportPath[] = [
  { name: '@mui/joy', importNames: ['Modal'], message },
  { name: '@mui/joy/Modal', message },
]

/**
 * A flat-config object that errors on a direct import of Joy's `Modal`.
 *
 * Add it after the app's other configs. The module that wraps `BackAwareModal`, if an
 * app has one that genuinely needs `Modal`, can be exempted with a following config
 * object that turns the rule off for that file.
 */
export const backAwareModalLintConfig: BackAwareModalLintConfig = {
  name: 'web-app-kit/back-aware-modal',
  rules: {
    'no-restricted-imports': [
      'error',
      { paths: backAwareModalRestrictedImportPaths },
    ],
  },
}
