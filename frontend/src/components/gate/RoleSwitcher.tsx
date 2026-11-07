import { ROLES, type Role } from "@/lib/role";
import { cn } from "@/lib/utils";

// Demo control. A real deployment takes the role from the user's SSO groups instead.
export function RoleSwitcher({
  role,
  onChange,
  large = false,
  className,
}: {
  role: Role;
  onChange: (r: Role) => void;
  large?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        role="group"
        aria-label="Role"
        aria-describedby="role-note"
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
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
                "rounded-md border-2 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2",
                large ? "min-h-16 px-5 text-xl" : "min-h-10 px-4 text-sm",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-foreground/70 bg-background text-foreground",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <p
        id="role-note"
        className={cn(large ? "text-xl" : "text-xs", "text-foreground/80 sm:text-right")}
      >
        Demo switch. A real deployment takes the role from SSO groups.
      </p>
    </div>
  );
}
