import { beforeAll, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const cliDir = path.resolve(here, '..')
const builtCli = path.join(cliDir, 'dist', 'index.js')

describe('cli (built)', () => {
  beforeAll(async () => {
    await execa('pnpm', ['-C', cliDir, '--silent', 'build'], {
      stdio: 'inherit',
      env: { ...process.env },
    })
  })

  it('page add creates files', async () => {
    const pageId = `test-page-${Date.now()}`
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentstage-smoke-'))
    const homeDir = path.join(tempDir, 'home')
    const workspaceDir = path.join(tempDir, 'workspace')
    const configDir = path.join(homeDir, '.config', 'agentstage')
    const workspaceFile = path.join(configDir, 'workspace')

    await fs.mkdir(configDir, { recursive: true })
    await fs.mkdir(workspaceDir, { recursive: true })
    await fs.writeFile(path.join(workspaceDir, 'package.json'), JSON.stringify({ name: 'smoke', private: true }))
    await fs.writeFile(workspaceFile, workspaceDir)

    await execa('node', [builtCli, 'page', 'add', pageId], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: homeDir },
    })

    const pagePath = path.join(workspaceDir, 'src', 'routes', `${pageId}.tsx`)
    const metaPath = path.join(workspaceDir, '.agentstage', 'types', `${pageId}.d.ts`)

    const stat1 = await fs.stat(pagePath)
    const stat2 = await fs.stat(metaPath)
    expect(stat1.isFile()).toBe(true)
    expect(stat2.isFile()).toBe(true)
  })
})
