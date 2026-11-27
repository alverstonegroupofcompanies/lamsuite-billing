import React from "react";
import type { LucideIcon } from "lucide-react";

type Tone = "neutral" | "brand" | "amber" | "emerald" | "rose";

const TONES: Record<Tone, string> = {
  neutral: "hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800",
  brand: "hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40",
  amber: "hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40",
  emerald: "hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40",
  rose: "hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40",
};

interface RowActionProps {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
  tone?: Tone;
  disabled?: boolean;
}

/**
 * The single icon button every table row uses for its Actions cell. Titles double as the accessible
 * name, so a test and a keyboard user see the same label a hover tooltip gives.
 */
export const RowAction: React.FC<RowActionProps> = ({ icon: Icon, title, onClick, tone = "neutral", disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    data-testid="row-action"
    className={`p-1.5 rounded-lg text-slate-400 transition disabled:opacity-40 disabled:pointer-events-none ${TONES[tone]}`}
  >
    <Icon className="w-3.5 h-3.5" />
  </button>
);
