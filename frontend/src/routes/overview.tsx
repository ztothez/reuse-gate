import { createFileRoute } from "@tanstack/react-router";
import { PageHeading } from "@/components/product/shared";
export const Route = createFileRoute("/overview")({ component: () => <PageHeading title="Executive overview" description="Demand, reuse and ownership across accessible requests." /> });
