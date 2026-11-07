import { useCallback, useEffect, useState } from "react";

export type Role = "requester" | "approver" | "executive" | "admin";

export const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "requester", label: "Requester", hint: "Ask for a report and get one clear answer" },
  { id: "approver", label: "Approver", hint: "Approve or reject with an owner and review date" },
  { id: "executive", label: "Executive", hint: "See demand, reuse and ownership across requests" },
  { id: "admin", label: "Admin", hint: "Radar, decision log and API health" },
];

export const ROLE_KEY = "reuse-gate-role";
export const DEFAULT_ROLE: Role = "requester";

export const isRole = (v: unknown): v is Role => ROLES.some((r) => r.id === v);

export function readRole(): Role {
  try {
    const v = localStorage.getItem(ROLE_KEY);
    return v === "steward" ? "admin" : isRole(v) ? v : DEFAULT_ROLE;
  } catch {
    return DEFAULT_ROLE;
  }
}

export function saveRole(role: Role) {
  try {
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    /* storage blocked: the role still applies for this page view */
  }
}

// The stored role is read after mount, so server and client render the same first frame.
export function useRole(): [Role, (r: Role) => void] {
  const [role, setRoleState] = useState<Role>(DEFAULT_ROLE);
  useEffect(() => setRoleState(readRole()), []);
  const setRole = useCallback((r: Role) => {
    saveRole(r);
    setRoleState(r);
  }, []);
  return [role, setRole];
}

export function hasInvalidStoredRole(): boolean {
  try {
    const value = localStorage.getItem(ROLE_KEY);
    return value !== null && value !== "steward" && !isRole(value);
  } catch {
    return false;
  }
}
