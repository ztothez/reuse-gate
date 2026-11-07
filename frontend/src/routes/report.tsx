import { createFileRoute } from "@tanstack/react-router";
import { ExecutiveReport } from "@/components/product/ExecutiveReport";
export const Route = createFileRoute("/report")({ component: ExecutiveReport });
