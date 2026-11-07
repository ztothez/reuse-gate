import { createFileRoute } from "@tanstack/react-router";
import { EvaluationPage } from "@/components/product/EvaluationPage";
export const Route = createFileRoute("/evaluation")({ component: EvaluationPage });
