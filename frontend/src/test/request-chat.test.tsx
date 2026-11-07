import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestChat, type ChatMessage } from "@/components/product/RequestChat";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiGet: api.apiGet,
  apiPost: api.apiPost,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: Math.random().toString(),
  request_id: "SAMPLE-07",
  author: "Ana Analyst",
  role: "analyst",
  text: "Which gates block release?",
  time: "2026-11-07T22:00:00Z",
  source: "person",
  ...over,
});

describe("request discussion", () => {
  it("shows people and the agent, says where each answer came from, and sends to the agent", async () => {
    api.apiGet.mockResolvedValue([
      msg({}),
      msg({
        author: "Reuse Gate agent",
        role: "agent",
        text: "1 of 7 gates block release.",
        source: "rules_guard",
      }),
    ]);
    api.apiPost.mockResolvedValue([]);
    render(<RequestChat id="SAMPLE-07" />);
    expect(await screen.findByText("1 of 7 gates block release.")).toBeInTheDocument();
    expect(
      screen.getByText(/the model's wording mentioned a fact not in this request/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Who owns it?" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(api.apiPost).toHaveBeenCalledWith("/requests/SAMPLE-07/chat", {
      message: "Who owns it?",
      ask_agent: true,
    });
  });
});
