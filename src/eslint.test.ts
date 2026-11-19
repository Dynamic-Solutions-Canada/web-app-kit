import assert from 'node:assert/strict'
import test from 'node:test'
import { Linter } from 'eslint'
import {
  backAwareModalLintConfig,
  backAwareModalRestrictedImportPaths,
} from './eslint.js'

const languageOptions = { ecmaVersion: 'latest', sourceType: 'module' } as const

/** Lints one snippet and returns the rule ids it reported. */
function lint(code: string, configs: Linter.Config[]): string[] {
  const linter = new Linter({ configType: 'flat' })
  return linter
    .verify(code, [{ languageOptions }, ...configs])
    .map((message) => message.ruleId ?? 'fatal')
}

const config = [backAwareModalLintConfig as Linter.Config]

test('a named import of Modal from @mui/joy is an error', () => {
  assert.deepEqual(lint("import { Modal } from '@mui/joy'", config), ['no-restricted-imports'])
})

test('an aliased Modal import is an error too', () => {
  assert.deepEqual(lint("import { Modal as JoyModal } from '@mui/joy'", config), [
    'no-restricted-imports',
  ])
})

test('the @mui/joy/Modal subpath is an error', () => {
  assert.deepEqual(lint("import Modal from '@mui/joy/Modal'", config), ['no-restricted-imports'])
})

test('the other modal parts stay allowed', () => {
  const code = "import { ModalClose, ModalDialog, ModalOverflow } from '@mui/joy'"
  assert.deepEqual(lint(code, config), [])
})

test('the exported paths combine with an app list in one rule entry', () => {
  const combined: Linter.Config = {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...backAwareModalRestrictedImportPaths,
            { name: 'lodash', message: 'Use the standard library.' },
          ],
        },
      ],
    },
  }
  const code = "import { Modal } from '@mui/joy'\nimport _ from 'lodash'"
  assert.deepEqual(lint(code, [combined]), ['no-restricted-imports', 'no-restricted-imports'])
})
