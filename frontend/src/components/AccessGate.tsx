import React, { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  counterSessionService,
  type CounterSessionState,
} from "../lib/auth/counterSessionService";

interface AccessGateProps {
  menu: string;
  children: React.ReactNode;
}

/**
 * PRF-001: the counter's permission document decides what this till opens.
 *
 * There is no signed-in person to ask, so a route refuses when the document
 * this counter carries leaves its module out — and says who can change it. A
 * till holding no document defers to the store's own menu ceiling rather than
 * inventing a surface of its own.
 */
export const AccessGate: React.FC<AccessGateProps> = ({ menu, children }) => {
  const [session, setSession] = useState<CounterSessionState>(() => counterSessionService.state());

  useEffect(() => {
    setSession(counterSessionService.state());
    return counterSessionService.subscribe(setSession);
  }, []);

  const granted = counterSessionService.allowsModule(menu);

  if (!granted) {
    const counterLabel = session.counterName || session.counterCode || "This counter";

    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center space-y-3">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
          <h2 className="text-base font-bold text-amber-900">Access restricted</h2>
          <p className="text-xs text-amber-800">
            {counterLabel} is not allowed to open this screen. The store owner sets what this
            counter may open in Admin Panel → Counters.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
