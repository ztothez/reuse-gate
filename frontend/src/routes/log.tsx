import { createFileRoute } from "@tanstack/react-router";
import { DecisionLog } from "@/components/gate/DecisionLog";
import { PageHeading } from "@/components/product/shared";
export const Route = createFileRoute("/log")({ component: () => <><PageHeading title="Decision log" description="Registered decisions with their evidence and simulation records." /><DecisionLog /></> });
