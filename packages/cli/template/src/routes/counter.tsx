import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { bridge, useBridgeStore } from '../lib/bridge'

export const Route = createFileRoute('/counter')({
  component: CounterPage,
})

function CounterPage() {
  const count = useBridgeStore(bridge, state => state.count)
  const isHydrated = bridge.isHydrated

  useEffect(() => {
    bridge.connect().then(({ storeId }) => {
      console.log('Connected to bridge:', storeId)
    })
  }, [])

  const increment = () => {
    bridge.store.setState(state => ({ count: state.count + 1 }))
  }

  const decrement = () => {
    bridge.store.setState(state => ({ count: state.count - 1 }))
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">File-based Store Demo</h1>
          <p className="text-muted-foreground">
            This page demonstrates the file-based store architecture.
            Refresh the page - state is persisted to disk!
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Counter</CardTitle>
            <CardDescription>
              {isHydrated ? 'Connected to bridge' : 'Connecting...'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-4xl font-bold text-center py-4">
              {count}
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={decrement} variant="outline">-</Button>
              <Button onClick={increment}>+</Button>
            </div>
            <div className="text-sm text-muted-foreground text-center">
              <p>State is saved to <code>pages/counter/store.json</code></p>
              <p>Try refreshing the page!</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
