import { useCallback, useState } from "react";
import {
  recommend,
  type Answer,
  type DashboardSpec,
  type GateResult,
  type Question,
  type RecommendResult,
} from "./api";

// What the approver registered for the current result, kept so every role sees the same outcome.
export interface Decided {
  mode?: "demo" | undefined;
  id: string;
  decision: "approve" | "reject";
  owner: string;
  reviewBy: string;
  spec?: DashboardSpec | undefined;
  gates?: GateResult | undefined;
}

export interface RequestState {
  outdated?: boolean;
  text: string;
  setText: (t: string) => void;
  loading: boolean;
  error: string | null;
  result: RecommendResult | null;
  rechecking: boolean;
  submit: () => Promise<void>;
  recheck: (fresh: Answer[]) => Promise<void>;
  // The requester chose to use the proposed report. Shown to the approver, not sent to the API.
  accepted: boolean;
  setAccepted: (a: boolean) => void;
  decided: Decided | null;
  setDecided: (d: Decided | null) => void;
  reset: () => void;
}

export const openQuestions = (r: RecommendResult): Question[] =>
  r.intent.questions ?? r.intent.clarifications.map((text) => ({ text, field: "model" }));

export function useRequestState(): RequestState {
  const [text, setText] = useState("");
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResultState] = useState<RecommendResult | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [decided, setDecided] = useState<Decided | null>(null);

  const setResult = useCallback((r: RecommendResult | null) => {
    setResultState(r);
    setAccepted(false);
    setDecided(null);
  }, []);

  const submit = useCallback(async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const next = await recommend(text);
      setSubmittedText(text);
      setResult(next);
    } catch {
      setError("Could not get a recommendation. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [text, setResult]);

  // Answers and the recorded loop rounds are sent in full each time, because the API keeps no state between checks.
  const recheck = useCallback(
    async (fresh: Answer[]) => {
      if (!result) return;
      setRechecking(true);
      setError(null);
      try {
        const next = await recommend(
          result.text,
          [...(result.answers ?? []), ...fresh],
          result.loop?.rounds,
        );
        setResult(next);
        setSubmittedText(next.text);
        setText(next.text);
      } catch {
        setError("Could not apply your answers. Please try again.");
      } finally {
        setRechecking(false);
      }
    },
    [result, setResult],
  );

  const reset = useCallback(() => {
    setText("");
    setError(null);
    setResult(null);
  }, [setResult]);

  return {
    outdated: result !== null && text !== submittedText,
    text,
    setText,
    loading,
    error,
    result,
    rechecking,
    submit,
    recheck,
    accepted,
    setAccepted,
    decided,
    setDecided,
    reset,
  };
}
