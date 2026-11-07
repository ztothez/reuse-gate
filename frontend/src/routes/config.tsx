import { createFileRoute } from "@tanstack/react-router";
import { ConfigPage } from "@/components/product/ConfigPage";
export const Route = createFileRoute("/config")({ component: ConfigPage });
