import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { isDemo, onDemoChange } from "@/lib/api";
import { hasInvalidStoredRole, useRole } from "@/lib/role";
import { useRequestState } from "@/lib/use-request";
import { RoleSwitcher } from "@/components/gate/RoleSwitcher";
import { RequesterView } from "@/components/gate/RequesterView";
import { ApproverView } from "@/components/gate/ApproverView";
import { NewRequest } from "@/components/gate/NewRequest";
import { AdminView } from "@/components/gate/AdminView";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reuse Gate: Reuse before you build" },
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
  const [role, setRole] = useRole();
  const [invalidStorage, setInvalidStorage] = useState(false);
  useEffect(() => setInvalidStorage(hasInvalidStoredRole()), []);
  // One request is shared by every role, so a requester's question reaches the approver.
  const request = useRequestState();
  useEffect(() => {
    setDemo(isDemo());
    return onDemoChange(setDemo);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="relative z-10 border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className="h-6 w-6 text-primary"
              aria-hidden
            />
            <span className="text-lg font-semibold tracking-tight">
              Reuse Gate
            </span>
            {demo && (
              <span
                className="tone-amber rounded-full border px-2 py-0.5 text-xs font-medium"
              >
                Demo data
              </span>
            )}
          </div>
          <RoleSwitcher
            role={role}
            onChange={setRole}
            className="w-full sm:w-auto"
          />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {invalidStorage && <div role="status" className="mb-6 text-sm">
          Invalid saved role was ignored. <button className="min-h-16 min-w-16 rounded border px-4 font-semibold" onClick={() => { setRole("requester"); setInvalidStorage(false); }}>Reset saved role</button>
        </div>}
        {role === "requester" && <RequesterView state={request} />}
        {role === "approver" && <ApproverView state={request} />}
        {role === "steward" && <NewRequest state={request} />}
        {role === "admin" && <AdminView />}
      </main>
    </div>
  );
}
