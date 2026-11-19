/**
 * Runs the typecheck and the tests against React 18, the older half of the peer range.
 *
 * The kit develops on React 19. This swaps React 18 and its types into node_modules for
 * one run (`--no-save`, so package.json and the lockfile are untouched), then restores
 * the locked versions whether the run passed or not. Remove it, and the `^18.3.1` half of
 * the peer range, once every consumer is on React 19.
 */
import { spawnSync } from 'node:child_process'

const react18 = [
  'react@18.3.1',
  'react-dom@18.3.1',
  '@types/react@18.3.31',
  '@types/react-dom@18.3.7',
]

/** Runs an npm command, streaming its output; returns its exit status. */
function npm(args) {
  const result = spawnSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  return result.status ?? 1
}

let status = npm(['install', '--no-save', '--no-audit', '--no-fund', ...react18])
if (status === 0) {
  // Printed so the log shows which React the run below actually used.
  const probe = spawnSync(process.execPath, ['-p', "'Testing on React ' + require('react/package.json').version"], {
    stdio: 'inherit',
  })
  status = probe.status ?? 1
}
if (status === 0) {
  status = npm(['run', 'typecheck'])
}
if (status === 0) {
  status = npm(['test'])
}

// Always put the locked React 19 back, so a failed run cannot leave the tree on React 18.
const restoreStatus = npm(['install', '--no-audit', '--no-fund'])
if (restoreStatus !== 0) {
  console.error('Restoring the locked dependencies failed; run npm ci before continuing.')
}

process.exit(status !== 0 ? status : restoreStatus)
