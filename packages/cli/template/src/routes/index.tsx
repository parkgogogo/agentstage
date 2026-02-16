import { createFileRoute } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

function IndexPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Agentstage</h1>
          <p className="text-muted-foreground">
            Interactive UI for AI Agents
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>
              Your Agentstage app is running. Use the CLI to add pages and components.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="Type something..." />
              <Button>Submit</Button>
            </div>
            <div className="text-sm text-muted-foreground">
              <p>Quick commands:</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li><code>agentstage add-page counter</code> - Add a new page</li>
                <li><code>agentstage ls</code> - List connected stores</li>
                <li><code>agentstage exec {'<storeId>'} setCount 5</code> - Execute action</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
