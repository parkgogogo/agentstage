import React from "react";
import { useStore } from "zustand";
import { z } from "zod";
import { createBridgeStore } from "@agentstage/bridge/browser";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/ui";

interface State {
  count: number;
  dispatch: (action: { type: string; payload?: unknown }) => void;
}

const stateSchema = z.object({
  count: z.number().describe("Counter value"),
});

const bridge = createBridgeStore<State, {
  add: { payload: { n: number } }
}>({
  pageId: "__PAGE_ID__",
  storeKey: "main",
  description: {
    schema: stateSchema,
    actions: {
      add: {
        description: "Add N to counter",
        payload: z.object({
          n: z.number().describe("Increment amount"),
        }),
      },
    },
  },
  createState: (set, get) => ({
    count: 0,
    dispatch: (action) => {
      if (action.type === "add") {
        set({ count: get().count + Number((action.payload as { n?: number })?.n ?? 0) });
      }
    },
  }),
});

const store = bridge.store;

export default function Page() {
  const count = useStore(store, (s) => s.count);

  React.useEffect(() => {
    let closed = false;
    let close = () => {};

    bridge
      .connect()
      .then((connected) => {
        if (closed) {
          connected.disconnect();
          return;
        }
        close = connected.disconnect;
      })
      .catch((err) => {
        console.error("[storebridge] connect failed", err);
      });

    return () => {
      closed = true;
      close();
    };
  }, []);

  return (
    <div className="p-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>__PAGE_TITLE__</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm">
            count: <b>{count}</b>
          </div>
          <Button
            onClick={() =>
              store
                .getState()
                .dispatch({ type: "add", payload: { n: 1 } })
            }
          >
            +1 (local)
          </Button>
          <div className="text-xs text-muted-foreground">
            This is a template page.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
