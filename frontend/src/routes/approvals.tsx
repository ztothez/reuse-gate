import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsPage } from "@/components/product/RequestPages";
export const Route = createFileRoute("/approvals")({ validateSearch: (search: Record<string, unknown>): { id?: string } => typeof search["id"] === "string" ? { id: search["id"] } : {}, component: ApprovalsPage });
