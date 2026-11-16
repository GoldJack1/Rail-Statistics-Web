import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The car drawings live on the VPS (see docs/FORMATION_DIAGRAMS.md) so they can be updated for
 * every client at once. Fail the build if a copy ends up in the site again.
 */
describe('train drawings are not bundled with the site', () => {
  const pub = join(process.cwd(), 'public')

  it('has no public/train-svgs folder', () => {
    expect(existsSync(join(pub, 'train-svgs'))).toBe(false)
  })

  it('has no per-car svg files anywhere under public/', () => {
    const found: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/^(END|MID|SINGLE)\d*(-raised)?\.svg$/.test(name)) found.push(p)
      }
    }
    walk(pub)
    expect(found).toEqual([])
  })
})
