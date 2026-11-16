import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { api } from "../services/api";
import {
  Building2,
  Shield,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Mail,
  Lock,
} from "lucide-react";

type AuthMode = "login" | "forgot" | "reset";

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { t } = useI18n();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requires2fa, setRequires2fa] = useState(false);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [manualCode, setManualCode] = useState<string>("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const linkEmail = params.get("email");
    if (token) {
      setMode("reset");
      setResetToken(token);
      if (linkEmail) setEmail(linkEmail);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const resetFeedback = () => {
    setError("");
    setNotice("");
    setManualCode("");
  };

  const handleLogin = async (e: React.FormEvent) => {
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

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();
    setIsLoading(true);

    try {
      const res = await api.post<{
        message: string;
        delivery: string;
        reset_token?: string;
        expires_in_minutes?: number;
      }>("/auth/forgot-password", { email });

      setNotice(res.message || t("auth.enter_reset_code"));
      setMode("reset");

      if (res.reset_token) {
        setResetToken(res.reset_token);
        setManualCode(
          t("auth.manual_code", { minutes: res.expires_in_minutes ?? 60 })
        );
      }
    } catch (err: any) {
      setError(err?.message || t("auth.reset_failed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();

    if (resetPassword !== resetConfirm) {
      setError(t("auth.password_mismatch"));
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.post<{ message: string }>("/auth/reset-password", {
        email,
        token: resetToken.trim(),
        password: resetPassword,
        password_confirmation: resetConfirm,
      });

      setMode("login");
      setRequires2fa(false);
      setPassword("");
      setResetPassword("");
      setResetConfirm("");
      setResetToken("");
      setNotice(res.message || t("auth.password_updated"));
    } catch (err: any) {
      setError(err?.message || t("auth.reset_failed"));
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    "w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition-all";

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

          {notice && !error && (
            <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-xs text-emerald-300 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {manualCode && !error && (
            <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 space-y-2">
              <div className="flex items-start gap-2.5">
                <KeyRound className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{manualCode}</span>
              </div>
              <div className="font-mono text-[11px] break-all bg-slate-950/60 rounded-lg px-2.5 py-2 text-amber-200">
                {resetToken}
              </div>
            </div>
          )}

          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
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
                      className={inputClass}
                      placeholder="admin@alverstone.in"
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
                      className={inputClass}
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
                    Enter the 6-digit verification code from your authenticator app (Google Authenticator / Authy).
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

              {!requires2fa && (
                <div className="flex items-center justify-between text-[11px] pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      resetFeedback();
                      setMode("forgot");
                    }}
                    className="text-brand-400 hover:text-brand-300 hover:underline cursor-pointer font-medium"
                  >
                    {t("auth.forgot_password")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetFeedback();
                      setMode("reset");
                    }}
                    className="text-slate-400 hover:text-slate-300 hover:underline cursor-pointer"
                  >
                    {t("auth.have_code")}
                  </button>
                </div>
              )}
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-bold">
                <Mail className="w-4 h-4" />
                <span>{t("auth.forgot_title")}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{t("auth.forgot_body")}</p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="admin@alverstone.in"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{t("auth.send_reset_code")}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  resetFeedback();
                  setMode("login");
                }}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-300 cursor-pointer pt-1"
              >
                <ArrowLeft className="w-3 h-3" />
                {t("auth.back_to_login")}
              </button>
            </form>
          )}

          {mode === "reset" && (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-bold">
                <Lock className="w-4 h-4" />
                <span>{t("auth.reset_title")}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{t("auth.enter_reset_code")}</p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="admin@alverstone.in"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {t("auth.reset_code")}
                </label>
                <input
                  type="text"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className={`${inputClass} font-mono`}
                  placeholder="Paste the reset code"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {t("auth.new_password")}
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••••••"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {t("auth.confirm_password")}
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{t("auth.update_password")}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  resetFeedback();
                  setMode("login");
                }}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-300 cursor-pointer pt-1"
              >
                <ArrowLeft className="w-3 h-3" />
                {t("auth.back_to_login")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
