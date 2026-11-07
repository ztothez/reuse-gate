import { createFileRoute } from "@tanstack/react-router";
import { AdminSettings } from "@/components/product/AdminSettings";
export const Route = createFileRoute("/admin")({ component: AdminSettings });
