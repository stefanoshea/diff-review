import { describe, expect, test, tier } from 'claude-code/testing'
import { uncommittedOf } from '../hooks/git/uncommitted.ts'
import { gitScript } from './fixtures/git-script.ts'

tier('user')

describe('uncommitted', () => {
  test('asks git which commented paths differ from HEAD, from the toplevel', async () => {
    const { run, runs } = gitScript({ 'diff --name-only HEAD': 'src/app.ts\n' })
    expect(await uncommittedOf(run, '/work', ['src/app.ts', 'new.txt'])).toEqual({ paths: ['src/app.ts'], error: null })
    expect(runs[0]?.argv).toEqual(['git', '--no-optional-locks', 'diff', '--name-only', 'HEAD', '--', 'src/app.ts', 'new.txt'])
    expect(runs[0]?.cwd).toBe('/work')
  })

  test('a clean tree gives no paths', async () => {
    const { run } = gitScript({ 'diff --name-only HEAD': '' })
    expect(await uncommittedOf(run, '/work', ['src/app.ts'])).toEqual({ paths: [], error: null })
  })

  test('no paths runs nothing', async () => {
    const { run, runs } = gitScript({})
    expect(await uncommittedOf(run, '/work', [])).toEqual({ paths: [], error: null })
    expect(runs).toEqual([])
  })

  test('a failed git call reports the first stderr line', async () => {
    const { run } = gitScript({ 'diff --name-only HEAD': { exitCode: 128, stdout: '', stderr: 'fatal: bad revision HEAD\nmore' } })
    expect(await uncommittedOf(run, '/work', ['src/app.ts'])).toEqual({ paths: [], error: 'fatal: bad revision HEAD' })
  })
})
