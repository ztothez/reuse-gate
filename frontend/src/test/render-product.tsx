import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { render, act } from "@testing-library/react";
import { routeTree } from "@/routeTree.gen";
import { Route as root } from "@/routes/__root";
export async function renderProduct(path: string) {
  // A document shell loads stylesheets in a browser. Tests render only its children.
  const options = root.options as typeof root.options & { shellComponent?: ComponentType<{ children: ReactNode }> };
  options.shellComponent = ({ children }) => <>{children}</>;
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }), context: { queryClient: new QueryClient() }, defaultPendingMinMs: 0 });
  await act(async () => { await router.load(); });
  const rendered = render(<RouterProvider router={router} />);
  return { ...rendered, router };
}
