import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, ClipboardCheck, Home, ListChecks, Menu, PanelLeftClose, Radar, Search, Settings, ShieldCheck, TrendingUp } from "lucide-react";
import { isDemo, onDemoChange } from "@/lib/api";
import { hasInvalidStoredRole, useRole } from "@/lib/role";
import { resetWorkCache, storageNotice } from "@/lib/work-item-cache";
import { itemsChanged } from "@/lib/use-resource";
import { RoleSwitcher } from "@/components/gate/RoleSwitcher";
const LensContext = createContext<ReturnType<typeof useRole> | null>(null);
export function LensProvider({ children }: { children: ReactNode }) { const lens = useRole(); return <LensContext.Provider value={lens}>{children}</LensContext.Provider>; }
export function useLens() { const value = useContext(LensContext); if (!value) throw new Error("Lens provider is required"); return value; }
const NAV = [{ to: "/", label: "Home", icon: Home }, { to: "/requests", label: "Requests", icon: ListChecks }, { to: "/approvals", label: "Approvals", icon: ClipboardCheck }, { to: "/overview", label: "Overview", icon: TrendingUp }, { to: "/radar", label: "Radar", icon: Radar }, { to: "/log", label: "Decision log", icon: BookOpen }, { to: "/admin", label: "Admin", icon: Settings }] as const;
export function AppShell({ children }: { children: ReactNode }) {
  const [role, setRole] = useLens(); const navigate = useNavigate();
  const [offline, setOffline] = useState(false); const [collapsed, setCollapsed] = useState(false); const [menu, setMenu] = useState(false); const [query, setQuery] = useState(""); const [invalid, setInvalid] = useState(false); const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  useEffect(() => { setOffline(isDemo()); setInvalid(hasInvalidStoredRole()); return onDemoChange(setOffline); }, []);
  useEffect(() => { const check = () => setCacheNotice(storageNotice()); const timer = setInterval(check, 1000); return () => clearInterval(timer); }, []);
  return <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
    <aside className={`app-nav ${menu ? "mobile-open" : ""}`} aria-label="Main navigation">
      <Link to="/" className="mb-6 flex min-h-16 items-center gap-3 px-3 font-semibold text-primary"><ShieldCheck aria-hidden className="h-7 w-7 shrink-0" /><span className={collapsed ? "md:sr-only" : ""}>Reuse Gate</span></Link>
      <nav className="space-y-1">{NAV.map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={() => setMenu(false)} activeOptions={{ exact: to === "/" }} activeProps={{ className: "nav-active" }} className="nav-link" title={collapsed ? label : undefined}><Icon aria-hidden className="h-5 w-5 shrink-0" /><span className={collapsed ? "md:sr-only" : ""}>{label}</span></Link>)}</nav>
      <button className="control mt-8 hidden w-full md:flex" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setCollapsed(!collapsed)}><PanelLeftClose aria-hidden className="h-5 w-5" /><span className={collapsed ? "sr-only" : ""}>Collapse</span></button>
    </aside>
    <div className="min-w-0">
      <header className="app-topbar">
        <div className="flex min-w-0 items-center gap-3"><button className="control shrink-0 md:hidden" aria-expanded={menu} aria-label="Toggle navigation" onClick={() => setMenu(!menu)}><Menu aria-hidden className="h-5 w-5" /></button><form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void navigate({ to: "/requests", search: { q: query } }); }}><Search aria-hidden className="hidden h-5 w-5 text-muted-foreground sm:block" /><label className="sr-only" htmlFor="global-search">Search requests</label><input id="global-search" className="control w-full min-w-0" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests" /><button className="control" type="submit">Search</button></form></div>
        <RoleSwitcher role={role} onChange={setRole} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><span className={`rounded-full border px-3 py-1 font-semibold ${offline ? "tone-amber" : "tone-green"}`}>{offline ? "Offline demo data" : "Live API"}</span><Link className="inline-flex min-h-16 items-center underline" to="/log">Open decision log</Link></div>
      </header>
      {offline && <div role="note" className="border-b bg-secondary px-4 py-3 text-sm sm:px-8"><strong>Offline demo data.</strong> Samples and local requests are not saved on the server. Approvals and simulations need the live API.</div>}
      {(invalid || cacheNotice) && <div role="status" className="border-b px-4 py-3 text-sm">{invalid ? "Invalid saved lens was ignored." : cacheNotice}<button className="control ml-3" onClick={() => { resetWorkCache(); setCacheNotice(null); setRole("requester"); setInvalid(false); itemsChanged(); }}>Reset saved data</button></div>}
      <main id="main-content" className="min-w-0 px-4 py-8 sm:px-8">{children}</main>
    </div>
  </div>;
}
