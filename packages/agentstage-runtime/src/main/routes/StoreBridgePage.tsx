import React from 'react'
import { useParams } from '@tanstack/react-router'

type PageModule = { default: React.ComponentType<any> }

const pageModules = import.meta.glob('../../pages/*/page.tsx')

function pageKey(pageId: string) {
  return `../../pages/${pageId}/page.tsx`
}

export function StoreBridgePage() {
  const { pageId } = useParams({ from: '/p/$pageId' })

  const [Comp, setComp] = React.useState<React.ComponentType<any> | null>(null)
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setComp(null)
    setErr(null)

    const loader = pageModules[pageKey(pageId)] as any
    if (!loader) {
      setErr(`Page not found: ${pageId}`)
      return
    }

    loader()
      .then((mod: PageModule) => {
        if (cancelled) return
        setComp(() => mod.default)
      })
      .catch((e: any) => {
        if (cancelled) return
        setErr(String(e?.message ?? e))
      })

    return () => {
      cancelled = true
    }
  }, [pageId])

  if (err) {
    return (
      <div className="p-6 space-y-2">
        <h1 className="text-xl font-semibold">Runtime</h1>
        <div className="text-sm text-destructive">{err}</div>
      </div>
    )
  }

  if (!Comp) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading page: {pageId}...</div>
    )
  }

  return <Comp />
}
