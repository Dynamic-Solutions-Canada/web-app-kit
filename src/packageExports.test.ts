/**
 * Checks the `exports` map as a consuming app sees it: both entry points must load through
 * `require()` as well as `import`, and both routes must reach the same module instance, because
 * the dialog stack is module state and a second copy would mean a second history listener.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const packageName = '@dynamic-solutions-canada/web-app-kit'

let packageDir = ''
let consumerDir = ''

/**
 * Builds the kit into a throwaway package and links it into a scratch consumer.
 *
 * The package sits under the repo's `node_modules/.cache/` so its peers (React, Joy, ESLint)
 * resolve from the repo's install, as they would from an app's; the consumer sits outside the
 * repo so nothing but the `exports` map decides what it can load. The build goes to its own
 * `dist/`, so the test never depends on, or overwrites, the repo's.
 */
before(() => {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache')
  mkdirSync(cacheDir, { recursive: true })
  packageDir = mkdtempSync(path.join(cacheDir, 'web-app-kit-exports-'))
  copyFileSync(
    path.join(repoRoot, 'package.json'),
    path.join(packageDir, 'package.json'),
  )
  execFileSync(
    path.join(repoRoot, 'node_modules', '.bin', 'tsc'),
    [
      '-p',
      path.join(repoRoot, 'tsconfig.build.json'),
      '--outDir',
      path.join(packageDir, 'dist'),
    ],
    { cwd: repoRoot, stdio: 'pipe' },
  )

  consumerDir = mkdtempSync(path.join(tmpdir(), 'web-app-kit-consumer-'))
  const scopeDir = path.join(
    consumerDir,
    'node_modules',
    '@dynamic-solutions-canada',
  )
  mkdirSync(scopeDir, { recursive: true })
  symlinkSync(packageDir, path.join(scopeDir, 'web-app-kit'), 'dir')
})

after(() => {
  for (const dir of [packageDir, consumerDir]) {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

/**
 * Loads both entry points from the consumer in a fresh CommonJS process, once through
 * `require()` and once through `import()`, and reports what each route returned.
 */
function loadFromConsumer(): {
  requireKeys: string[]
  requireEslintKeys: string[]
  sameKit: boolean
  sameEslint: boolean
} {
  const script = `
    const kit = require('${packageName}')
    const eslint = require('${packageName}/eslint')
    ;(async () => {
      const kitImport = await import('${packageName}')
      const eslintImport = await import('${packageName}/eslint')
      process.stdout.write(JSON.stringify({
        requireKeys: Object.keys(kit),
        requireEslintKeys: Object.keys(eslint),
        sameKit: kit === kitImport,
        sameEslint: eslint === eslintImport,
      }))
    })()
  `
  const output = execFileSync(
    process.execPath,
    ['--input-type=commonjs', '--eval', script],
    // A clean NODE_OPTIONS keeps the test runner's own loader (tsx) out of the child, so this
    // checks Node's resolution and nothing else.
    {
      cwd: consumerDir,
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
    },
  )
  return JSON.parse(output) as ReturnType<typeof loadFromConsumer>
}

test('both entry points load through require() and import as one instance', () => {
  const loaded = loadFromConsumer()

  assert.ok(loaded.requireKeys.includes('BackAwareModal'))
  assert.ok(loaded.requireKeys.includes('useResetOnChange'))
  assert.ok(loaded.requireEslintKeys.includes('backAwareModalLintConfig'))

  // require(esm) returns the ES module namespace itself, so identity proves one copy.
  assert.equal(loaded.sameKit, true)
  assert.equal(loaded.sameEslint, true)
})
