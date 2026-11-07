import { useCallback, useEffect, useState } from "react";
import { getMe, sessions, setActiveRole, SIGN_IN_EVENT } from "./api";
import { itemsChanged } from "./use-resource";

export type Role = "business" | "analyst" | "developer" | "approver" | "admin";
export type RequestTab = "answer" | "evidence" | "spec" | "gates" | "activity";

export type NavPath =
  "/" | "/requests" | "/approvals" | "/overview" | "/radar" | "/log" | "/evaluation";

// "Viewing as" gives each person their own app: their home, their sidebar and the request tabs they need, in their order.
// It is a view, not a permission: links still open, and write access comes from the API.
export interface RoleView {
  id: Role;
  label: string;
  hint: string;
  home: string;
  nav: NavPath[];
  tabs: RequestTab[];
  settings: boolean;
}
export const ROLES: RoleView[] = [
  {
    id: "business",
    label: "Business",
    hint: "Ask for a report and get one clear answer",
    home: "Ask",
    nav: ["/", "/requests"],
    tabs: ["answer", "activity"],
    settings: false,
  },
  {
    id: "analyst",
    label: "Analyst",
    hint: "The cited rows and data quality behind each decision",
    home: "Evidence",
    nav: ["/", "/requests", "/radar", "/evaluation"],
    tabs: ["evidence", "answer", "gates"],
    settings: false,
  },
  {
    id: "developer",
    label: "Developer",
    hint: "The dashboard specs to build or change",
    home: "Build queue",
    nav: ["/", "/requests", "/log"],
    tabs: ["spec", "evidence", "gates"],
    settings: false,
  },
  {
    id: "approver",
    label: "Approver",
    hint: "Gates, owner and review date before approval",
    home: "Decisions",
    nav: ["/", "/approvals", "/requests", "/overview", "/radar", "/log"],
    tabs: ["gates", "answer", "evidence", "activity"],
    settings: true,
  },
  {
    id: "admin",
    label: "Admin",
    hint: "Everything: health, access code, all screens and tabs",
    home: "Settings",
    nav: ["/", "/requests", "/approvals", "/overview", "/radar", "/log", "/evaluation"],
    tabs: ["activity", "answer", "evidence", "spec", "gates"],
    settings: false,
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
export const roleView = (role: Role): RoleView => ROLES.find((r) => r.id === role)!;
export const roleTab = (role: Role): RequestTab => roleView(role).tabs[0]!;

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

// Access as the API sees it. enforced: the API checks a role code on every call (least privilege). signedIn: this tab holds a
// valid code. roles: the roles this tab is signed in to; only those can be chosen in "Viewing as".
export interface Access {
  enforced: boolean;
  signedIn: boolean;
  name: string | null;
  roles: Role[];
}
const OPEN_ACCESS: Access = {
  enforced: false,
  signedIn: true,
  name: null,
  roles: ROLES.map((r) => r.id),
};

// The role is read after mount, so server and client render the same first frame. With enforced codes the API decides the
// role; without them (local development) the stored choice or a ?as= link does.
export function useRole(): [Role, (r: Role) => void, Access, () => void] {
  const [role, setRoleState] = useState<Role>(DEFAULT_ROLE);
  const [access, setAccess] = useState<Access>(OPEN_ACCESS);
  const openRole = () => {
    const linked = roleFromLink();
    if (linked) saveRole(linked);
    setRoleState(linked ?? readRole());
  };
  const refresh = useCallback(() => {
    getMe()
      .then((me) => {
        if (me && !me.enforced) {
          setAccess(OPEN_ACCESS);
          openRole();
          return;
        }
        const held = sessions()
          .map((s) => s.role)
          .filter(isRole);
        if (!me || !isRole(me.role)) {
          setAccess({ enforced: true, signedIn: false, name: null, roles: held });
          return;
        }
        setRoleState(me.role);
        setAccess({
          enforced: true,
          signedIn: true,
          name: me.name,
          roles: held.length ? held : [me.role],
        });
      })
      .catch(() => openRole()); // API unreachable: data calls show their own error
  }, []);
  useEffect(() => {
    refresh();
    const ask = () => setAccess((a) => ({ ...a, enforced: true, signedIn: false }));
    window.addEventListener(SIGN_IN_EVENT, ask);
    return () => window.removeEventListener(SIGN_IN_EVENT, ask);
  }, [refresh]);
  const setRole = useCallback(
    (r: Role) => {
      if (access.enforced) {
        setActiveRole(r);
        refresh();
        itemsChanged();
        return;
      }
      saveRole(r);
      setRoleState(r);
    },
    [access.enforced, refresh],
  );
  return [role, setRole, access, refresh];
}

export function hasInvalidStoredRole(): boolean {
  try {
    const value = localStorage.getItem(ROLE_KEY);
    return value !== null && !(value in LEGACY) && !isRole(value);
  } catch {
    return false;
  }
}
