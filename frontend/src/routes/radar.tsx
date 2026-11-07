import { createFileRoute } from "@tanstack/react-router";
import { RadarView } from "@/components/gate/RadarView";
import { PageHeading } from "@/components/product/shared";
export const Route = createFileRoute("/radar")({ component: () => <><PageHeading title="Governance radar" description="Find the ownership, usage and definition issues behind governed reporting." /><RadarView /></> });
