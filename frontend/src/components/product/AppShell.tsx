import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquare,
  MonitorDot,
  PanelLeftClose,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { getRequests, isDemo, onDemoChange, signOut } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { hasInvalidStoredRole, roleView, useRole } from "@/lib/role";
import { resetWorkCache, storageNotice } from "@/lib/work-item-cache";
import { itemsChanged } from "@/lib/use-resource";
import { RoleSwitcher } from "@/components/gate/RoleSwitcher";
import { SystemStatus } from "./DecisionTrail";
import { SignIn } from "./SignIn";
const LensContext = createContext<ReturnType<typeof useRole> | null>(null);
export function LensProvider({ children }: { children: ReactNode }) {
  const lens = useRole();
  return <LensContext.Provider value={lens}>{children}</LensContext.Provider>;
}
export function useLens() {
  const value = useContext(LensContext);
  if (!value) throw new Error("Lens provider is required");
  return value;
}
const NAV = [
  { to: "/", label: "Ask", icon: MessageSquare },
  { to: "/requests", label: "Requests", icon: ListChecks },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { to: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
  { to: "/config", label: "Configuration", icon: SlidersHorizontal },
  { to: "/report", label: "Executive report", icon: FileText },
  { to: "/wall", label: "Operations wall", icon: MonitorDot },
  { to: "/workflows", label: "Workflows and email", icon: Workflow },
  { to: "/overview", label: "Overview", icon: TrendingUp },
  { to: "/radar", label: "Radar", icon: Radar },
  { to: "/log", label: "Decision log", icon: BookOpen },
  { to: "/evaluation", label: "Evaluation", icon: BarChart3 },
] as const;
const HOME_ICON: Partial<Record<string, typeof MessageSquare>> = {
  executive: FileText,
  operator: MonitorDot,
  admin: Settings,
  developer: SlidersHorizontal,
  analyst: Radar,
  approver: ClipboardCheck,
};
export function AppShell({ children }: { children: ReactNode }) {
  const [role, setRole, access, refresh] = useLens();
  const navigate = useNavigate();
  const view = roleView(role);
  const [adding, setAdding] = useState(false);
  const [offline, setOffline] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  useEffect(() => {
    setOffline(isDemo());
    setInvalid(hasInvalidStoredRole());
    return onDemoChange(setOffline);
  }, []);
  const decides = view.nav.includes("/approvals");
  const items = useResource(
    () => (decides && access.signedIn ? getRequests() : Promise.resolve([])),
    `${role}-${access.signedIn}`,
  );
  const waiting = (items.data ?? []).filter(
    (row) => row.status === "awaiting_approval" || row.status === "human_review",
  ).length;
  useEffect(() => {
    const check = () => setCacheNotice(storageNotice());
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
      <aside className={`app-nav ${menu ? "mobile-open" : ""}`} aria-label="Main navigation">
        <Link
          to="/"
          className="mb-6 flex min-h-16 items-center gap-3 px-3 font-semibold text-primary"
        >
          <ShieldCheck aria-hidden className="h-7 w-7 shrink-0" />
          <span className={collapsed ? "md:sr-only" : ""}>Reuse Gate</span>
        </Link>
        <nav className="space-y-1">
          {NAV.filter((item) => view.nav.includes(item.to)).map(
            ({ to, label: base, icon: navIcon }) => {
              const label = to === "/" ? view.home : base;
              const Icon = to === "/" ? (HOME_ICON[role] ?? navIcon) : navIcon;
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMenu(false)}
                  activeOptions={{ exact: to === "/" }}
                  activeProps={{ className: "nav-active" }}
                  className="nav-link"
                  title={collapsed ? label : undefined}
                >
                  <Icon aria-hidden className="h-5 w-5 shrink-0" />
                  <span className={collapsed ? "md:sr-only" : ""}>{label}</span>
                  {to === "/approvals" && waiting > 0 && (
                    <span
                      className="tone-amber ml-auto rounded-full border px-2 text-xs font-semibold"
                      aria-label={`${waiting} waiting`}
                    >
                      {waiting}
                    </span>
                  )}
                </Link>
              );
            },
          )}
        </nav>
        {access.signedIn && (
          <RoleSwitcher
            role={role}
            onChange={(r) => {
              setAdding(false);
              setRole(r);
            }}
            access={access}
            onAdd={() => setAdding(true)}
            onSignOut={() => {
              signOut();
              setAdding(false);
              refresh();
              itemsChanged();
            }}
            className={`mt-8 px-3 ${collapsed ? "md:hidden" : ""}`}
          />
        )}
        {view.settings && (
          <Link
            to="/admin"
            onClick={() => setMenu(false)}
            activeProps={{ className: "nav-active" }}
            className="nav-link mt-4"
            title={collapsed ? "Settings" : undefined}
          >
            <Settings aria-hidden className="h-5 w-5 shrink-0" />
            <span className={collapsed ? "md:sr-only" : ""}>Settings</span>
          </Link>
        )}
        <button
          className="control mt-8 hidden w-full md:flex"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => setCollapsed(!collapsed)}
        >
          <PanelLeftClose aria-hidden className="h-5 w-5" />
          <span className={collapsed ? "sr-only" : ""}>Collapse</span>
        </button>
      </aside>
      <div className="min-w-0">
        <header className="app-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="control shrink-0 md:hidden"
              aria-expanded={menu}
              aria-label="Toggle navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu aria-hidden className="h-5 w-5" />
            </button>
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void navigate({ to: "/requests", search: { q: query } });
              }}
            >
              <Search aria-hidden className="hidden h-5 w-5 text-muted-foreground sm:block" />
              <label className="sr-only" htmlFor="global-search">
                Search requests
              </label>
              <input
                id="global-search"
                className="control w-full min-w-0"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search requests"
              />
              <button className="control" type="submit">
                Search
              </button>
            </form>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <SystemStatus offline={offline} />
            {view.nav.includes("/log") && (
              <Link className="inline-flex min-h-16 items-center underline" to="/log">
                Open decision log
              </Link>
            )}
          </div>
        </header>
        {offline && (
          <div role="note" className="border-b bg-secondary px-4 py-3 text-sm sm:px-8">
            <strong>Offline demo data.</strong> Samples and local requests are not saved on the
            server. Approvals and simulations need the live API.
          </div>
        )}
        {(invalid || cacheNotice) && (
          <div role="status" className="border-b px-4 py-3 text-sm">
            {invalid ? "Invalid saved lens was ignored." : cacheNotice}
            <button
              className="control ml-3"
              onClick={() => {
                resetWorkCache();
                setCacheNotice(null);
                setRole("business");
                setInvalid(false);
                itemsChanged();
              }}
            >
              Reset saved data
            </button>
          </div>
        )}
        <main data-lens={role} id="main-content" className="min-w-0 px-4 py-8 sm:px-8">
          {access.enforced && !access.signedIn ? (
            <SignIn
              onDone={() => {
                refresh();
                itemsChanged();
              }}
            />
          ) : adding ? (
            <SignIn
              adding
              onDone={() => {
                setAdding(false);
                refresh();
                itemsChanged();
              }}
            />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
