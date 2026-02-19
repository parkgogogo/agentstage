import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { PageRenderer } from '../components/PageRenderer'
import { createPageBridge } from '../lib/bridge'

export const Route = createFileRoute('/counter')({
  component: CounterPage,
})

function CounterPage() {
  // Create bridge instance for this page
  const bridge = useMemo(() => {
    return createPageBridge({
      pageId: 'counter',
    })
  }, [])

  return <PageRenderer pageId="counter" bridge={bridge} />
}
