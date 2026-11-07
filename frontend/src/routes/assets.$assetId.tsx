import { createFileRoute } from "@tanstack/react-router";
import { AssetPage } from "@/components/product/RadarPage";
export const Route = createFileRoute("/assets/$assetId")({ component: Asset });
function Asset() {
  const { assetId } = Route.useParams();
  return <AssetPage id={assetId} />;
}
