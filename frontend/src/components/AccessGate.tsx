import React, { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { staffAuthService, type StaffUser } from "../lib/auth/staffAuthService";
import { canAccessMenu } from "../lib/auth/accessControl";

interface AccessGateProps {
  menu: string;
  children: React.ReactNode;
}

/**
 * Blocks a route when the signed-in staff member lacks the module permission
 * that the menu item maps to. Renders an explicit refusal instead of a silent
 * redirect so the operator knows why the screen is unavailable.
 */
export const AccessGate: React.FC<AccessGateProps> = ({ menu, children }) => {
  const [user, setUser] = useState<StaffUser | null>(
    () => staffAuthService.getCurrentSession()?.user || null
  );

  useEffect(() => {
    setUser(staffAuthService.getCurrentSession()?.user || null);
    return staffAuthService.onSessionChange((session) => {
      setUser(session?.user || null);
    });
  }, []);

  if (user && !canAccessMenu(user, menu)) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center space-y-3">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
          <h2 className="text-base font-bold text-amber-900">Access restricted</h2>
          <p className="text-xs text-amber-800">
            Your role ({user.role.replace(/_/g, " ")}) does not include permission for this module.
            Ask a store owner or manager to grant access in Admin Panel → Users &amp; Roles.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
