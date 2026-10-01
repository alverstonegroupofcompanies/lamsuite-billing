import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Building2, Shield, KeyRound, ArrowRight, Lock, AlertCircle } from "lucide-react";

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@lamstone.in");
  const [password, setPassword] = useState("password123");
  const [totpCode, setTotpCode] = useState("");
  const [requires2fa, setRequires2fa] = useState(false);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await login({ email, password, totp_code: totpCode || undefined });
      if (res.requires_2fa) {
        setRequires2fa(true);
      }
    } catch (err: any) {
      setError(err?.message || "Invalid credentials or account locked.");
    } finally {
      setIsLoading(false);
    }
  };

  const setDemoCredentials = (roleEmail: string) => {
    setEmail(roleEmail);
    setPassword("password123");
    setRequires2fa(false);
    setError("");
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-brand-500 to-indigo-600 flex items-center justify-center text-white mx-auto shadow-lg shadow-brand-500/25">
          <Building2 className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight">LamSuite Central Admin</h2>
        <p className="text-xs text-slate-400">Retail & Pharmacy Chain Cloud Control Panel</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!requires2fa ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition-all"
                    placeholder="admin@lamstone.in"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition-all"
                    placeholder="••••••••••••"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3 bg-brand-950/40 p-4 rounded-xl border border-brand-800/40">
                <div className="flex items-center gap-2 text-brand-400 text-xs font-bold">
                  <Shield className="w-4 h-4" />
                  <span>Two-Factor Authentication (TOTP)</span>
                </div>
                <p className="text-xs text-slate-300">
                  Enter the 6-digit verification code from your authenticator app (Google Authenticator / Authy) or demo code <code className="text-brand-300 font-mono">123456</code>.
                </p>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="w-full tracking-widest text-center text-lg font-mono px-3.5 py-2.5 bg-slate-900 border border-brand-500/50 rounded-xl text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                  placeholder="123456"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{requires2fa ? "Verify & Enter Admin" : "Sign In to Admin Panel"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Quick Demo Role Switcher */}
          <div className="mt-6 pt-5 border-t border-slate-700/60">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 text-center">
              Quick Switch Demo Roles
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setDemoCredentials("admin@lamstone.in")}
                className="px-2 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 text-slate-300 hover:text-white border border-slate-700/40 text-left truncate transition-colors"
              >
                👑 Super Admin
              </button>
              <button
                type="button"
                onClick={() => setDemoCredentials("owner@lamstone.in")}
                className="px-2 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 text-slate-300 hover:text-white border border-slate-700/40 text-left truncate transition-colors"
              >
                🏬 Store Owner
              </button>
              <button
                type="button"
                onClick={() => setDemoCredentials("accountant@lamstone.in")}
                className="px-2 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 text-slate-300 hover:text-white border border-slate-700/40 text-left truncate transition-colors"
              >
                📊 Accountant (Reports Only)
              </button>
              <button
                type="button"
                onClick={() => setDemoCredentials("support@lamstone.in")}
                className="px-2 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 text-slate-300 hover:text-white border border-slate-700/40 text-left truncate transition-colors"
              >
                🛡️ Support (Read-only)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
