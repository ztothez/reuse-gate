import { createFileRoute } from "@tanstack/react-router";
import { RadarPage } from "@/components/product/RadarPage";
export const Route = createFileRoute("/radar")({
  validateSearch: (search: Record<string, unknown>): { finding?: string } =>
    typeof search["finding"] === "string" &&
    ["conflicts", "ownerless", "uncertified", "dead"].includes(search["finding"])
      ? { finding: search["finding"] }
      : {},
  component: RadarPage,
});
