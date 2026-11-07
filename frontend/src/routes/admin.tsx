import { createFileRoute } from "@tanstack/react-router";
import { AdminView } from "@/components/gate/AdminView";
import { PageHeading } from "@/components/product/shared";
export const Route = createFileRoute("/admin")({ component: () => <><PageHeading title="Admin settings" description="API availability, access and ownership." /><AdminView /></> });
