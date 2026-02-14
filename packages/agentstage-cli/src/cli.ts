#!/usr/bin/env node
import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'

import { workspaceRootFromHere, runtimeDir, pageDir, pageFile, metaFile } from './paths.js'
import { pageTsxTemplate, metaJsonTemplate } from './templates.js'

const program = new Command()

program.name('agentstage').description('Agentstage CLI (runtime + StoreBridge) (MVP)')

program
  .command('start')
  .description('Start runtime dev server + storebridge server (MVP)')
  .option('--runtime-port <port>', 'Runtime port', '5173')
  .option('--bridge-port <port>', 'StoreBridge server port', '8787')
  .option('--json', 'Output json')
  .action(async (opts) => {
    const agentstageRoot = workspaceRootFromHere(import.meta.url)
    const rtDir = runtimeDir(agentstageRoot)

    const runtimePort = Number(opts.runtimePort)
    const bridgePort = Number(opts.bridgePort)

    // Start StoreBridge server as a separate process (so runtime restarts won't kill it).
    const bridge = execa('pnpm', ['-C', path.join(agentstageRoot, 'packages', 'bridge-store'), 'start:server'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BRIDGE_STORE_PORT: String(bridgePort),
      },
    })

    const runtime = execa('pnpm', ['-C', rtDir, 'dev', '--', '--port', String(runtimePort)], {
      stdio: 'inherit',
      env: {
        ...process.env,
        STOREBRIDGE_RUNTIME_PORT: String(runtimePort),
        VITE_STOREBRIDGE_WS: `ws://127.0.0.1:${bridgePort}`,
      },
    })

    const out = {
      runtimeUrl: `http://127.0.0.1:${runtimePort}`,
      storeBridgeWs: `ws://127.0.0.1:${bridgePort}`,
    }

    if (opts.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(out))
    } else {
      // eslint-disable-next-line no-console
      console.log('runtime:', out.runtimeUrl)
      // eslint-disable-next-line no-console
      console.log('storebridge:', out.storeBridgeWs)
    }

    // Keep alive
    await Promise.race([bridge, runtime])
  })

program
  .command('page:new')
  .description('Create a new runtime page')
  .argument('<pageId>', 'page id')
  .option('--title <title>', 'page title')
  .option('--json', 'Output json')
  .action(async (pageId, opts) => {
    const agentstageRoot = workspaceRootFromHere(import.meta.url)
    const dir = pageDir(agentstageRoot, pageId)

    const title = opts.title ?? pageId

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(pageFile(agentstageRoot, pageId), pageTsxTemplate({ pageId, title }), 'utf8')
    await fs.writeFile(metaFile(agentstageRoot, pageId), metaJsonTemplate({ pageId, title }), 'utf8')

    const out = {
      kind: 'page',
      pageId,
      title,
      pagePath: pageFile(agentstageRoot, pageId),
      metaPath: metaFile(agentstageRoot, pageId),
    }

    if (opts.json) console.log(JSON.stringify(out))
    else console.log(out.pagePath)
  })

program
  .command('page:path')
  .description('Print page file paths')
  .argument('<pageId>', 'page id')
  .option('--json', 'Output json')
  .action(async (pageId, opts) => {
    const agentstageRoot = workspaceRootFromHere(import.meta.url)
    const out = {
      pageId,
      pagePath: pageFile(agentstageRoot, pageId),
      metaPath: metaFile(agentstageRoot, pageId),
    }
    if (opts.json) console.log(JSON.stringify(out))
    else console.log(out.pagePath)
  })

program.parseAsync()
