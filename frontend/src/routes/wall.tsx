import { createFileRoute } from "@tanstack/react-router";
import { OperatorWall } from "@/components/product/OperatorWall";
export const Route = createFileRoute("/wall")({ component: OperatorWall });
