import { ROLES, type Role } from "@/lib/role";
import { cn } from "@/lib/utils";

// A lens changes perspective; write permission comes from the API.
export function RoleSwitcher({
  role,
  onChange,
  className,
}: {
  role: Role;
  onChange: (r: Role) => void;
  large?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div
        role="group"
        aria-label="Lens"
        aria-describedby="role-note"
        className="grid grid-cols-4 rounded-lg bg-secondary p-1"
      >
        {ROLES.map((r) => {
          const active = r.id === role;
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(r.id)}
              className={cn(
                "min-h-16 min-w-16 break-words rounded-md px-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4 sm:text-sm",
                active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-card",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <p id="role-note" className="text-xs text-muted-foreground sm:text-right">
        Lenses change the view. API write access is controlled separately.
      </p>
    </div>
  );
}
