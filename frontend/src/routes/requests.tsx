import { Outlet, useLocation, createFileRoute } from "@tanstack/react-router";
import { RequestsPage } from "@/components/product/RequestPages";
export type RequestSearch = Partial<Record<"q" | "status" | "owner" | "origin" | "from" | "to" | "sort" | "create" | "target", string>>;
export const Route = createFileRoute("/requests")({ validateSearch: (search: Record<string, unknown>): RequestSearch => Object.fromEntries(Object.entries(search).filter(([key, value]) => ["q", "status", "owner", "origin", "from", "to", "sort", "create", "target"].includes(key) && typeof value === "string")), component: RequestRoute });

function RequestRoute() { const location = useLocation(); return location.pathname.replace(/\/$/, "") === "/requests" ? <RequestsPage /> : <Outlet />; }
