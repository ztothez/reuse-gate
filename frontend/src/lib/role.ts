import { useCallback, useEffect, useState } from "react";

export type Role = "business" | "analyst" | "developer" | "approver" | "admin";
export type RequestTab = "answer" | "evidence" | "spec" | "gates" | "activity";

// "Viewing as" changes what opens first and how much is shown. Write permission still comes from the API.
export const ROLES: { id: Role; label: string; hint: string; tab: RequestTab }[] = [
  { id: "business", label: "Business", hint: "One clear answer in plain language", tab: "answer" },
  { id: "analyst", label: "Analyst", hint: "The cited rows behind each decision", tab: "evidence" },
  {
    id: "developer",
    label: "Developer",
    hint: "The dashboard spec to build or change",
    tab: "spec",
  },
  {
    id: "approver",
    label: "Approver",
    hint: "Gates, owner and review date before approval",
    tab: "gates",
  },
  {
    id: "admin",
    label: "Admin",
    hint: "Activity trail, API health and access code",
    tab: "activity",
  },
];

export const ROLE_KEY = "reuse-gate-role";
export const DEFAULT_ROLE: Role = "business";
// Values saved by earlier versions of the app.
const LEGACY: Record<string, Role> = {
  requester: "business",
  executive: "business",
  steward: "admin",
};

export const isRole = (v: unknown): v is Role => ROLES.some((r) => r.id === v);
export const roleTab = (role: Role): RequestTab => ROLES.find((r) => r.id === role)!.tab;

export function readRole(): Role {
  try {
    const v = localStorage.getItem(ROLE_KEY);
    return isRole(v) ? v : (v && LEGACY[v]) || DEFAULT_ROLE;
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

// A link can open a view directly: ?as=analyst. It is remembered like a choice from the menu.
function roleFromLink(): Role | null {
  try {
    const value = new URLSearchParams(window.location.search).get("as");
    return isRole(value) ? value : null;
  } catch {
    return null;
  }
}

// The stored role is read after mount, so server and client render the same first frame.
export function useRole(): [Role, (r: Role) => void] {
  const [role, setRoleState] = useState<Role>(DEFAULT_ROLE);
  useEffect(() => {
    const linked = roleFromLink();
    if (linked) saveRole(linked);
    setRoleState(linked ?? readRole());
  }, []);
  const setRole = useCallback((r: Role) => {
    saveRole(r);
    setRoleState(r);
  }, []);
  return [role, setRole];
}

export function hasInvalidStoredRole(): boolean {
  try {
    const value = localStorage.getItem(ROLE_KEY);
    return value !== null && !(value in LEGACY) && !isRole(value);
  } catch {
    return false;
  }
}
