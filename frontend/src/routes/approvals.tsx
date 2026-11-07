import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsPage } from "@/components/product/RequestPages";
export const Route = createFileRoute("/approvals")({ component: ApprovalsPage });
