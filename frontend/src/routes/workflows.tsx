import { createFileRoute } from "@tanstack/react-router";
import { WorkflowsPage } from "@/components/product/WorkflowsPage";
export const Route = createFileRoute("/workflows")({ component: WorkflowsPage });
