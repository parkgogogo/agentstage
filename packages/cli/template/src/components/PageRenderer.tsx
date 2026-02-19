import { useEffect, useState } from 'react'
import type { Spec } from '@agentstage/render'
import { Renderer, defineRegistry, defineCatalog, schema } from '@agentstage/render'
import { shadcnComponents, shadcnComponentDefinitions } from '@agentstage/render/shadcn'
import type { Bridge } from '../lib/bridge'
import { BridgeStateProvider } from './bridge-state-provider'

interface PageRendererProps {
  pageId: string
  bridge: Bridge
}

// Create catalog with all shadcn components
const catalog = defineCatalog(schema, {
  components: {
    Card: shadcnComponentDefinitions.Card,
    Button: shadcnComponentDefinitions.Button,
    Input: shadcnComponentDefinitions.Input,
    Stack: shadcnComponentDefinitions.Stack,
    Text: shadcnComponentDefinitions.Text,
    Heading: shadcnComponentDefinitions.Heading,
    Badge: shadcnComponentDefinitions.Badge,
    Separator: shadcnComponentDefinitions.Separator,
    Dialog: shadcnComponentDefinitions.Dialog,
    Tabs: shadcnComponentDefinitions.Tabs,
    Table: shadcnComponentDefinitions.Table,
  },
  actions: {},
})

// Create registry
const { registry } = defineRegistry(catalog, {
  components: {
    Card: shadcnComponents.Card,
    Button: shadcnComponents.Button,
    Input: shadcnComponents.Input,
    Stack: shadcnComponents.Stack,
    Text: shadcnComponents.Text,
    Heading: shadcnComponents.Heading,
    Badge: shadcnComponents.Badge,
    Separator: shadcnComponents.Separator,
    Dialog: shadcnComponents.Dialog,
    Tabs: shadcnComponents.Tabs,
    Table: shadcnComponents.Table,
  },
})

export function PageRenderer({ pageId, bridge }: PageRendererProps) {
  const [uiSpec, setUiSpec] = useState<Spec | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Load ui.json
    fetch(`/src/pages/${pageId}/ui.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ui.json: ${res.status}`)
        return res.json()
      })
      .then((spec) => {
        setUiSpec(spec)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [pageId])

  // Connect to bridge
  useEffect(() => {
    bridge.connect().then((result: { storeId: string }) => {
      console.log('Connected to bridge:', result.storeId)
    })
  }, [bridge])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading UI...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive">Error: {error}</div>
      </div>
    )
  }

  if (!uiSpec) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">No UI spec found</div>
      </div>
    )
  }

  return (
    <BridgeStateProvider bridge={bridge}>
      <div className="min-h-screen bg-background p-8">
        <Renderer spec={uiSpec} registry={registry} />
      </div>
    </BridgeStateProvider>
  )
}
