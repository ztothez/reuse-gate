import { createFileRoute } from "@tanstack/react-router";
import { RequestDetailPage } from "@/components/product/RequestPages";
export const Route = createFileRoute("/requests/$requestId")({ component: Item });
function Item() { const { requestId } = Route.useParams(); return <RequestDetailPage id={requestId} />; }
