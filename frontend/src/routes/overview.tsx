import { createFileRoute } from "@tanstack/react-router";
import { ExecutiveOverview } from "@/components/product/ExecutiveOverview";
export const Route = createFileRoute("/overview")({ component: ExecutiveOverview });
