import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getHealth, type Health } from "@/lib/api";
import { RadarView } from "./RadarView";
import { DecisionLog } from "./DecisionLog";

const HEALTH_TEXT: Record<Health["status"], (h: Health) => string> = {
  live: (h) => `API live${h.assets !== undefined ? `, ${h.assets} assets loaded` : ""}`,
  down: () => "API not reachable. The app falls back to demo data.",
  demo: () => "No API configured. The app shows demo data.",
};
const HEALTH_TONE: Record<Health["status"], string> = {
  live: "tone-green",
  down: "tone-red",
  demo: "tone-amber",
};

export function HealthIndicator() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const check = useCallback(async () => {
    setChecking(true);
    setHealth(await getHealth());
    setChecking(false);
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p
        role="status"
        className={`${health ? HEALTH_TONE[health.status] : "tone-gray"} inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium`}
      >
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: "currentColor" }}
        />
        {health && !checking
          ? `Health (GET /health): ${HEALTH_TEXT[health.status](health)}`
          : "Checking API health..."}
      </p>
      <Button variant="outline" size="sm" onClick={check} disabled={checking}>
        {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
      </Button>
    </div>
  );
}

export function AdminView() {
  return (
    <div className="space-y-6">
      <HealthIndicator />
      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Decision log</TabsTrigger>
          <TabsTrigger value="radar">Radar</TabsTrigger>
        </TabsList>
        <TabsContent value="log" className="mt-6">
          <DecisionLog />
        </TabsContent>
        <TabsContent value="radar" className="mt-6">
          <RadarView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
