import React, { useState, useEffect, useRef } from "react";
import { Plus, Minus } from "lucide-react";
import {
  parseSmartQty,
  normalizePackLoose,
  type UnitConversionConfig,
} from "../lib/billing/unitConversion";

interface SmartQtyInputProps {
  packs: number;
  loose: number;
  unitsPerPack: number;
  packName?: string;
  looseName?: string;
  allowLoose?: boolean;
  disabled?: boolean;
  autoFocusPackOnMount?: boolean;
  inputId?: string;
  onChange: (packs: number, loose: number) => void;
  onEnter?: () => void;
  onFocusInput?: () => void;
  onBlurInput?: () => void;
  className?: string;
}

export const SmartQtyInput: React.FC<SmartQtyInputProps> = ({
  packs,
  loose,
  unitsPerPack,
  packName = "pack",
  looseName = "pc",
  allowLoose = true,
  disabled = false,
  autoFocusPackOnMount = false,
  inputId,
  onChange,
  onEnter,
  onFocusInput,
  onBlurInput,
  className = "",
}) => {
  const upp = Math.max(1, Number(unitsPerPack) || 1);
  const isLooseAllowed = allowLoose && upp > 1;

  // Local text representation for smooth typing
  const [packText, setPackText] = useState(packs.toString());
  const [looseText, setLooseText] = useState(loose.toString());
  const [isFocused, setIsFocused] = useState(false);
  const [showNormalizedHighlight, setShowNormalizedHighlight] = useState(false);

  const packInputRef = useRef<HTMLInputElement>(null);
  const looseInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocusPackOnMount) {
      setTimeout(() => {
        packInputRef.current?.focus();
        packInputRef.current?.select();
      }, 30);
    }
  }, [autoFocusPackOnMount]);

  useEffect(() => {
    if (!isFocused) {
      setPackText(packs.toString());
      setLooseText(loose.toString());
    }
  }, [packs, loose, isFocused]);

  const config: UnitConversionConfig = {
    units_per_pack: upp,
    pack_unit_name: packName,
    loose_unit_name: looseName,
    allow_loose_sale: isLooseAllowed,
  };

  const totalBaseUnits = Math.round((packs * upp + loose) * 1000) / 1000;

  // --- Handlers for Pack Input ---
  const handlePackChange = (newPacks: number) => {
    const p = Math.max(0, newPacks);
    setPackText(p.toString());
    onChange(p, loose);
  };

  const onPackInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPackText(val);

    // Smart parsing for "2+5", "+5", "2.5", "10t"
    if (val.includes("+")) {
      const parts = val.split("+");
      const p = parts[0].trim() ? parseFloat(parts[0]) || 0 : 0;
      const l = parts[1].trim() ? parseFloat(parts[1]) || 0 : 0;
      const norm = normalizePackLoose(p, l, upp);

      setPackText(norm.packs.toString());
      setLooseText(norm.loose.toString());
      onChange(norm.packs, norm.loose);

      // Jump focus to loose input
      setTimeout(() => {
        looseInputRef.current?.focus();
        looseInputRef.current?.select();
      }, 10);
      return;
    }

    if (val.includes(".")) {
      const floatVal = parseFloat(val);
      if (!isNaN(floatVal) && floatVal >= 0) {
        const totalLoose = Math.round(floatVal * upp);
        const norm = normalizePackLoose(0, totalLoose, upp);
        setPackText(norm.packs.toString());
        setLooseText(norm.loose.toString());
        onChange(norm.packs, norm.loose);
        return;
      }
    }

    const num = val === "" ? 0 : parseFloat(val);
    if (!isNaN(num) && num >= 0) {
      onChange(Math.floor(num), loose);
    }
  };

  const onPackKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const num = parseFloat(packText) || 0;
      onChange(num, loose);
      if (onEnter) onEnter();
      return;
    }

    if (e.key === "+") {
      e.preventDefault();
      looseInputRef.current?.focus();
      looseInputRef.current?.select();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      handlePackChange(packs + 1);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      handlePackChange(Math.max(0, packs - 1));
      return;
    }

    if (e.key === "ArrowRight" && packInputRef.current) {
      const input = packInputRef.current;
      if (input.selectionStart === input.value.length && isLooseAllowed) {
        e.preventDefault();
        looseInputRef.current?.focus();
        looseInputRef.current?.select();
      }
    }
  };

  const onPackBlur = () => {
    setIsFocused(false);
    const num = parseFloat(packText) || 0;
    setPackText(num.toString());
    onChange(num, loose);
  };

  // --- Handlers for Loose Input ---
  const handleLooseChange = (newLoose: number) => {
    const l = Math.max(0, newLoose);
    const norm = normalizePackLoose(packs, l, upp);
    if (norm.isNormalized) {
      setShowNormalizedHighlight(true);
      setTimeout(() => setShowNormalizedHighlight(false), 1200);
    }
    setPackText(norm.packs.toString());
    setLooseText(norm.loose.toString());
    onChange(norm.packs, norm.loose);
  };

  const onLooseInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLooseText(val);

    const num = val === "" ? 0 : parseFloat(val);
    if (!isNaN(num) && num >= 0) {
      if (num >= upp) {
        // Auto-normalize if typed value exceeds pack size
        const norm = normalizePackLoose(packs, num, upp);
        setShowNormalizedHighlight(true);
        setTimeout(() => setShowNormalizedHighlight(false), 1200);
        setPackText(norm.packs.toString());
        setLooseText(norm.loose.toString());
        onChange(norm.packs, norm.loose);
      } else {
        onChange(packs, num);
      }
    }
  };

  const onLooseKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const num = parseFloat(looseText) || 0;
      const norm = normalizePackLoose(packs, num, upp);
      setPackText(norm.packs.toString());
      setLooseText(norm.loose.toString());
      onChange(norm.packs, norm.loose);
      if (onEnter) onEnter();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      handleLooseChange(loose + 1);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      handleLooseChange(Math.max(0, loose - 1));
      return;
    }

    if (e.key === "Backspace" && (looseText === "" || looseText === "0") && packInputRef.current) {
      e.preventDefault();
      packInputRef.current.focus();
      packInputRef.current.select();
      return;
    }

    if (e.key === "ArrowLeft" && looseInputRef.current && packInputRef.current) {
      const input = looseInputRef.current;
      if (input.selectionStart === 0) {
        e.preventDefault();
        packInputRef.current.focus();
        packInputRef.current.select();
      }
    }
  };

  const onLooseBlur = () => {
    setIsFocused(false);
    const num = parseFloat(looseText) || 0;
    const norm = normalizePackLoose(packs, num, upp);
    setPackText(norm.packs.toString());
    setLooseText(norm.loose.toString());
    onChange(norm.packs, norm.loose);
  };

  // --- Non-loose single unit view ---
  if (!isLooseAllowed) {
    return (
      <div className={`flex flex-col items-center select-none ${className}`}>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white shadow-2xs overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || packs <= 1}
            onClick={() => handlePackChange(Math.max(1, packs - 1))}
            className="px-1.5 py-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-colors"
            title="Decrease Quantity"
          >
            <Minus className="h-3 w-3" />
          </button>
          <input
            ref={packInputRef}
            id={inputId ? `${inputId}-pack` : undefined}
            type="text"
            inputMode="numeric"
            disabled={disabled}
            value={packText}
            onFocus={() => {
              setIsFocused(true);
              if (onFocusInput) onFocusInput();
              packInputRef.current?.select();
            }}
            onBlur={() => {
              onPackBlur();
              if (onBlurInput) onBlurInput();
            }}
            onChange={(e) => {
              setPackText(e.target.value);
              const num = parseFloat(e.target.value) || 0;
              onChange(Math.max(1, num), 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (onEnter) onEnter();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                handlePackChange(packs + 1);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                handlePackChange(Math.max(1, packs - 1));
              }
            }}
            className="w-12 text-center font-bold text-slate-800 text-xs py-1 px-1 outline-none bg-transparent"
            title="Enter quantity"
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => handlePackChange(packs + 1)}
            className="px-1.5 py-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-colors"
            title="Increase Quantity"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <span className="mt-0.5 text-[10px] text-slate-400 lowercase">
          {packName || "pcs"}
        </span>
      </div>
    );
  }

  // --- Dual Pack + Loose view ---
  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      <div
        className={`inline-flex items-center rounded-lg border bg-white shadow-2xs overflow-hidden transition-all ${
          showNormalizedHighlight
            ? "border-amber-400 ring-2 ring-amber-200 bg-amber-50/50"
            : "border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/30"
        }`}
      >
        {/* Pack Stepper Minus */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || (packs <= 0 && loose <= 0)}
          onClick={() => handlePackChange(Math.max(0, packs - 1))}
          className="px-1 py-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 transition-colors"
          title={`Decrease ${packName}`}
        >
          <Minus className="h-3 w-3" />
        </button>

        {/* Pack Input Box */}
        <div className="flex items-center bg-slate-50/50 px-0.5 rounded">
          <input
            ref={packInputRef}
            id={inputId ? `${inputId}-pack` : undefined}
            type="text"
            inputMode="numeric"
            disabled={disabled}
            value={packText}
            placeholder="0"
            onChange={onPackInputChange}
            onKeyDown={onPackKeyDown}
            onFocus={() => {
              setIsFocused(true);
              if (onFocusInput) onFocusInput();
              packInputRef.current?.select();
            }}
            onBlur={() => {
              onPackBlur();
              if (onBlurInput) onBlurInput();
            }}
            className="w-7 text-center font-bold text-slate-800 text-xs py-0.5 outline-none bg-transparent"
            title={`Enter ${packName} count (type '+' or '2+5' to enter loose)`}
          />
          <span className="text-[9px] font-semibold text-slate-400 lowercase select-none pr-1">
            {packName.length > 5 ? packName.slice(0, 4) : packName}
          </span>
        </div>

        {/* Pack Stepper Plus */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => handlePackChange(packs + 1)}
          className="px-1 py-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 transition-colors"
          title={`Increase ${packName}`}
        >
          <Plus className="h-3 w-3" />
        </button>

        {/* Plus separator */}
        <span className="text-slate-300 font-bold px-0.5 text-xs select-none">+</span>

        {/* Loose Stepper Minus */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || (loose <= 0 && packs <= 0)}
          onClick={() => handleLooseChange(Math.max(0, loose - 1))}
          className="px-1 py-1 text-blue-400 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-20 transition-colors"
          title={`Decrease ${looseName}`}
        >
          <Minus className="h-3 w-3" />
        </button>

        {/* Loose Input Box */}
        <div className="flex items-center bg-blue-50/50 px-0.5 rounded">
          <input
            ref={looseInputRef}
            id={inputId ? `${inputId}-loose` : undefined}
            type="text"
            inputMode="numeric"
            disabled={disabled}
            value={looseText}
            placeholder="0"
            onChange={onLooseInputChange}
            onKeyDown={onLooseKeyDown}
            onFocus={() => {
              setIsFocused(true);
              if (onFocusInput) onFocusInput();
              looseInputRef.current?.select();
            }}
            onBlur={() => {
              onLooseBlur();
              if (onBlurInput) onBlurInput();
            }}
            className="w-7 text-center font-bold text-blue-700 text-xs py-0.5 outline-none bg-transparent"
            title={`Enter loose ${looseName} count`}
          />
          <span className="text-[9px] font-semibold text-blue-500 lowercase select-none pr-1">
            {looseName.length > 5 ? looseName.slice(0, 4) : looseName}
          </span>
        </div>

        {/* Loose Stepper Plus */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => handleLooseChange(loose + 1)}
          className="px-1 py-1 text-blue-400 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-20 transition-colors"
          title={`Increase ${looseName}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Live Total & Conversion Hint */}
      <div className="mt-0.5 text-[10px] text-slate-500 font-medium whitespace-nowrap">
        <span className="text-blue-700 font-bold">
          = {totalBaseUnits} {totalBaseUnits === 1 ? looseName : `${looseName}s`}
        </span>
        <span className="text-slate-400 ml-1">
          ({packs} {packs === 1 ? packName : `${packName}s`}
          {loose > 0 ? ` + ${loose} ${loose === 1 ? looseName : `${looseName}s`}` : ""})
        </span>
      </div>
    </div>
  );
};
