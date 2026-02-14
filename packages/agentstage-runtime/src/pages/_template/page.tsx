import React from "react";
import { useStore } from "zustand";
import { z } from "zod";

import { createStoreBridgeBrowserSync } from "bridge-store/browser";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/ui";

type State = {
  count: number;
  dispatch: (action: { type: string; payload?: any }) => void;
};

const stateSchema = z.object({
  count: z.number().describe("Counter value"),
});

const bridge = createStoreBridgeBrowserSync<State>({
  bridgeUrl: import.meta.env.VITE_STOREBRIDGE_WS ?? "ws://127.0.0.1:8787",
  pageId: "__PAGE_ID__",
  storeKey: "main",
  meta: {
    id: "__PAGE_ID__",
    title: "__PAGE_TITLE__",
    store: {
      stateSchema,
      actions: [
        {
          type: "counter.add",
          description: "Add N to counter",
          payloadSchema: z.object({
            n: z.number().describe("Increment amount"),
          }),
        },
      ],
    },
  },
  createState: (set, get) => ({
    count: 0,
    dispatch: (action) => {
      if (action.type === "counter.add") {
        set({ count: get().count + Number(action.payload?.n ?? 0) });
      }
    },
  }),
});

const store = bridge.store;

export default function Page() {
  const count = useStore(store as any, (s: any) => s.count);

  React.useEffect(() => {
    let closed = false;
    let close = () => {};

    bridge
      .attach()
      .then((attached) => {
        if (closed) {
          attached.close();
          return;
        }
        close = attached.close;
      })
      .catch((err) => {
        console.error("[storebridge] attach failed", err);
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
                .dispatch({ type: "counter.add", payload: { n: 1 } })
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
