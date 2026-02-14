import { describe, expect, it } from 'vitest'
import { execa } from 'execa'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const cliDir = path.resolve(here, '..')

describe('agentstage-cli', () => {
  it('page:new creates files', async () => {
    const pageId = `test-page-${Date.now()}`

    const res = await execa('pnpm', ['-C', cliDir, '--silent', 'dev', 'page:new', pageId, '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    })

    const out = JSON.parse(res.stdout)
    expect(out.pageId).toBe(pageId)

    const stat1 = await fs.stat(out.pagePath)
    const stat2 = await fs.stat(out.metaPath)
    expect(stat1.isFile()).toBe(true)
    expect(stat2.isFile()).toBe(true)
  })
})
