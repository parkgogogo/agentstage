import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import React from 'react'
import { StoreBridgePage } from './routes/StoreBridgePage'

const rootRoute = createRootRoute({
  component: function Root() {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Outlet />
      </div>
    )
  },
})

const pRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$pageId',
  component: StoreBridgePage,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function Index() {
    return (
      <div className="p-6 space-y-2">
        <h1 className="text-2xl font-semibold">Agentstage Runtime</h1>
        <p className="text-sm text-muted-foreground">Open /p/&lt;pageId&gt;</p>
      </div>
    )
  },
})

const routeTree = rootRoute.addChildren([indexRoute, pRoute])

export const router = createRouter({ routeTree })

// NOTE: In this MVP we avoid the @tanstack router type augmentation to keep setup minimal.
