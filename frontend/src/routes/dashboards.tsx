import { createFileRoute } from "@tanstack/react-router";
import { DashboardBuilder } from "@/components/product/DashboardBuilder";
export const Route = createFileRoute("/dashboards")({ component: DashboardBuilder });
