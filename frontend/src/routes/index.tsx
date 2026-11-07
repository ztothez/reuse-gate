import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isDemo, onDemoChange } from "@/lib/api";
import { NewRequest } from "@/components/gate/NewRequest";
import { RadarView } from "@/components/gate/RadarView";
import { DecisionLog } from "@/components/gate/DecisionLog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reuse Gate — Reuse before you build" },
      {
        name: "description",
        content:
          "Check whether an existing report can be reused, repaired, extended, migrated or retired before building a new dashboard.",
      },
      { property: "og:title", content: "Reuse Gate" },
      { property: "og:description", content: "AI analytics governance: reuse before you build." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    setDemo(isDemo());
    return onDemoChange(setDemo);
  }, []);

  return (
    <Tabs defaultValue="new" className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">Reuse Gate</span>
            {demo && (
              <span className="tone-amber rounded-full border px-2 py-0.5 text-xs font-medium">
                Demo data
              </span>
            )}
          </div>
          <TabsList className="ml-auto">
            <TabsTrigger value="new">New request</TabsTrigger>
            <TabsTrigger value="radar">Radar</TabsTrigger>
            <TabsTrigger value="log">Decision log</TabsTrigger>
          </TabsList>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <TabsContent value="new">
          <NewRequest />
        </TabsContent>
        <TabsContent value="radar">
          <RadarView />
        </TabsContent>
        <TabsContent value="log">
          <DecisionLog />
        </TabsContent>
      </main>
    </Tabs>
  );
}
