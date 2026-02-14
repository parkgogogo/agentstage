import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function workspaceRootFromHere(metaUrl: string) {
  // packages/storebridge-cli/dist/.. -> packages/storebridge-cli -> packages -> agentstage
  const here = path.dirname(fileURLToPath(metaUrl))
  return path.resolve(here, '..', '..', '..')
}

export function runtimeDir(agentstageRoot: string) {
  return path.join(agentstageRoot, 'packages', 'agentstage-runtime')
}

export function runtimePagesDir(agentstageRoot: string) {
  return path.join(runtimeDir(agentstageRoot), 'src', 'pages')
}

export function pageDir(agentstageRoot: string, pageId: string) {
  return path.join(runtimePagesDir(agentstageRoot), pageId)
}

export function pageFile(agentstageRoot: string, pageId: string) {
  return path.join(pageDir(agentstageRoot, pageId), 'page.tsx')
}

export function metaFile(agentstageRoot: string, pageId: string) {
  return path.join(pageDir(agentstageRoot, pageId), 'meta.json')
}
