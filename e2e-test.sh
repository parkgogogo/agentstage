#!/bin/bash
set -e

echo "🧪 Agentstage File-based Store E2E Test"
echo "=========================================="

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
cd /Users/dnq/.openclaw/workspace/agentstage/packages/cli/template
pnpm install

# Step 2: Start dev server in background
echo "🚀 Starting dev server..."
pnpm dev &
DEV_PID=$!

# Wait for server to be ready
echo "⏳ Waiting for server to start..."
sleep 5

# Step 3: Run agent-browser e2e tests
echo "🌐 Running agent-browser e2e tests..."

# Navigate to counter page
agent-browser open http://localhost:5173/counter

# Take initial screenshot
agent-browser screenshot --full /Users/dnq/.openclaw/workspace/agentstage/test-results/01-initial.png

# Get snapshot to find elements
agent-browser snapshot -i

# Click increment button (find by text or ref)
echo "➕ Clicking increment button..."
agent-browser find text "+" click

# Wait a moment
sleep 1

# Take screenshot after increment
agent-browser screenshot --full /Users/dnq/.openclaw/workspace/agentstage/test-results/02-after-increment.png

# Click increment again
echo "➕ Clicking increment button again..."
agent-browser find text "+" click
sleep 1

agent-browser screenshot --full /Users/dnq/.openclaw/workspace/agentstage/test-results/03-after-second-increment.png

# Click decrement
echo "➖ Clicking decrement button..."
agent-browser find text "-" click
sleep 1

agent-browser screenshot --full /Users/dnq/.openclaw/workspace/agentstage/test-results/04-after-decrement.png

# Get page text to verify
echo "📄 Getting page content..."
agent-browser get text body > /Users/dnq/.openclaw/workspace/agentstage/test-results/page-content.txt

# Close browser
agent-browser close

# Step 4: Check if store.json was created
echo "💾 Checking file store..."
if [ -f "/Users/dnq/.openclaw/workspace/agentstage/packages/cli/template/src/pages/counter/store.json" ]; then
    echo "✅ Store file created successfully!"
    cat /Users/dnq/.openclaw/workspace/agentstage/packages/cli/template/src/pages/counter/store.json
else
    echo "⚠️  Store file not found at expected location"
    find /Users/dnq/.openclaw/workspace/agentstage/packages/cli/template -name "store.json" 2>/dev/null || true
fi

# Cleanup: Stop dev server
echo "🛑 Stopping dev server..."
kill $DEV_PID 2>/dev/null || true

echo ""
echo "✅ E2E test completed!"
echo "📸 Screenshots saved to /Users/dnq/.openclaw/workspace/agentstage/test-results/"
