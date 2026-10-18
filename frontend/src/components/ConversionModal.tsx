import React, { useState, useEffect } from "react";
import { X, Layers, Check, Sparkles, Store, Pill, ShoppingBag } from "lucide-react";
import type { PosCartLine } from "../lib/billing/posCartService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface ConversionModalProps {
  isOpen: boolean;
  line: PosCartLine | null;
  onClose: () => void;
  onSave: (
    lineId: string,
    unitsPerPack: number,
    packName: string,
    looseName: string,
    persistMaster: boolean
  ) => void;
}

interface PresetItem {
  label: string;
  upp: number;
  pack: string;
  loose: string;
}

const CATEGORY_PRESETS: { id: string; name: string; icon: any; presets: PresetItem[] }[] = [
  {
    id: "cosmetics_retail",
    name: "Cosmetics & Retail",
    icon: Store,
    presets: [
      { label: "1 Box = 12 Pcs", upp: 12, pack: "box", loose: "pc" },
      { label: "1 Box = 6 Pcs", upp: 6, pack: "box", loose: "pc" },
      { label: "1 Pack = 6 Bottles", upp: 6, pack: "pack", loose: "bottle" },
      { label: "1 Carton = 24 Jars", upp: 24, pack: "carton", loose: "jar" },
      { label: "1 Set = 3 Items", upp: 3, pack: "set", loose: "item" },
      { label: "1 Single Unit (No Loose)", upp: 1, pack: "pc", loose: "pc" },
    ],
  },
  {
    id: "pharmacy",
    name: "Pharmacy & Clinical",
    icon: Pill,
    presets: [
      { label: "10 tabs / strip", upp: 10, pack: "strip", loose: "tab" },
      { label: "15 tabs / strip", upp: 15, pack: "strip", loose: "tab" },
      { label: "20 tabs / strip", upp: 20, pack: "strip", loose: "tab" },
      { label: "10 caps / strip", upp: 10, pack: "strip", loose: "capsule" },
      { label: "100 tabs / box", upp: 100, pack: "box", loose: "tab" },
      { label: "1 Bottle (Syrup)", upp: 1, pack: "bottle", loose: "ml" },
    ],
  },
  {
    id: "grocery_fmcg",
    name: "FMCG & Grocery",
    icon: ShoppingBag,
    presets: [
      { label: "1 Carton = 12 Bottles", upp: 12, pack: "carton", loose: "bottle" },
      { label: "1 Case = 24 Cans", upp: 24, pack: "case", loose: "can" },
      { label: "1 Box = 20 Packs", upp: 20, pack: "box", loose: "pack" },
      { label: "1 Kg = 1000 Grams", upp: 1000, pack: "kg", loose: "g" },
      { label: "1 Litre = 1000 ml", upp: 1000, pack: "litre", loose: "ml" },
      { label: "1 Piece (Single)", upp: 1, pack: "piece", loose: "piece" },
    ],
  },
];

export const ConversionModal: React.FC<ConversionModalProps> = ({
  isOpen,
  line,
  onClose,
  onSave,
}) => {
  useModalEscape(isOpen && Boolean(line), onClose);

  const [activeCategory, setActiveCategory] = useState<string>("cosmetics_retail");
  const [unitsPerPack, setUnitsPerPack] = useState<number>(line?.product.units_per_pack || 1);
  const [packName, setPackName] = useState<string>(line?.product.unit_name || ((line?.product.units_per_pack || 1) > 1 ? "pack" : "pc"));
  const [looseName, setLooseName] = useState<string>(line?.product.sub_unit_name || ((line?.product.units_per_pack || 1) > 1 ? "pc" : "unit"));
  const [persistMaster, setPersistMaster] = useState<boolean>(false);

  useEffect(() => {
    if (line) {
      const upp = line.product.units_per_pack || 1;
      setUnitsPerPack(upp);
      setPackName(line.product.unit_name || (upp > 1 ? "pack" : "pc"));
      setLooseName(line.product.sub_unit_name || (upp > 1 ? "pc" : "unit"));
      setPersistMaster(false);

      // Auto-select tab based on naming
      if (line.product.unit_name === "strip" || line.product.sub_unit_name === "tab") {
        setActiveCategory("pharmacy");
      } else if (line.product.unit_name === "kg" || line.product.unit_name === "litre") {
        setActiveCategory("grocery_fmcg");
      } else {
        setActiveCategory("cosmetics_retail");
      }
    }
  }, [line]);

  if (!isOpen || !line) return null;

  const handleApplyPreset = (preset: PresetItem) => {
    setUnitsPerPack(preset.upp);
    setPackName(preset.pack);
    setLooseName(preset.loose);
  };

  const handleSave = () => {
    const upp = Math.max(1, Number(unitsPerPack) || 1);
    onSave(
      line.id,
      upp,
      packName.trim() || (upp > 1 ? "pack" : "pc"),
      looseName.trim() || (upp > 1 ? "pc" : "unit"),
      persistMaster
    );
    onClose();
  };

  const effectivePrice = line.unit_price;
  const derivedLooseRate = unitsPerPack > 1 ? (effectivePrice / unitsPerPack).toFixed(2) : effectivePrice.toFixed(2);
  const activePresetCategory = CATEGORY_PRESETS.find((c) => c.id === activeCategory) || CATEGORY_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
      <div className="w-full max-w-lg rounded-card bg-surface shadow-modal border border-border-main overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-border-main flex items-center justify-between bg-canvas">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-accent-soft text-accent rounded-btn">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-main">Adjust Product Unit & Packaging</h2>
              <p className="text-xs text-text-muted truncate max-w-[320px] font-medium">
                {line.product.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-main rounded-btn hover:bg-surface transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs bg-surface">
          {/* Industry Preset Category Tabs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                Packaging Presets by Store Type
              </label>
            </div>
            <div className="flex gap-1.5 p-1 bg-canvas border border-border-main rounded-btn mb-3">
              {CATEGORY_PRESETS.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActiveCategory(cat.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[8px] text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? "bg-surface text-accent shadow-2xs border border-border-main font-bold"
                        : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-3 gap-2">
              {activePresetCategory.presets.map((preset) => {
                const isSelected = unitsPerPack === preset.upp && packName.toLowerCase() === preset.pack.toLowerCase();
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={`py-2 px-2 rounded-btn text-xs font-medium border text-center transition-all cursor-pointer ${
                      isSelected
                        ? "bg-accent-soft border-accent text-accent shadow-2xs font-bold"
                        : "bg-canvas border-border-main text-text-main hover:bg-surface"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conversion Equation Input */}
          <div className="p-4 bg-canvas border border-border-main rounded-card">
            <label className="block text-[11px] font-bold text-text-main mb-2 uppercase tracking-wider">
              Custom Packaging Ratio & Names:
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <span className="text-[10px] text-text-muted font-semibold block mb-0.5">1 Parent Unit (Pack / Box)</span>
                <input
                  type="text"
                  value={packName}
                  onChange={(e) => setPackName(e.target.value)}
                  placeholder="e.g. box, bottle, pc, jar"
                  className="w-full px-2.5 py-1.5 rounded-btn border border-border-main bg-surface font-semibold text-text-main text-xs focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                />
              </div>
              <span className="text-base font-black text-text-muted mt-4">=</span>
              <div className="w-24">
                <span className="text-[10px] text-accent font-bold block mb-0.5">Contains Qty</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={unitsPerPack}
                  onChange={(e) => setUnitsPerPack(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-2.5 py-1.5 rounded-btn border border-accent bg-surface font-bold font-mono text-accent text-center text-xs focus:ring-1 focus:ring-accent outline-none"
                />
              </div>
              <div className="flex-1">
                <span className="text-[10px] text-text-muted font-semibold block mb-0.5">Base Unit (Loose / Sub-unit)</span>
                <input
                  type="text"
                  value={looseName}
                  onChange={(e) => setLooseName(e.target.value)}
                  placeholder="e.g. pc, unit, ml, g"
                  className="w-full px-2.5 py-1.5 rounded-btn border border-border-main bg-surface font-semibold text-text-main text-xs focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                />
              </div>
            </div>

            {/* Calculated Rates Summary */}
            <div className="mt-3 pt-2.5 border-t border-border-main flex items-center justify-between text-[11px]">
              <span className="text-text-muted">
                Pack Rate: <strong className="text-text-main font-mono">₹{effectivePrice.toFixed(2)}</strong> /{packName || "pack"}
              </span>
              <span className="text-accent font-semibold">
                {unitsPerPack > 1 ? (
                  <>Derived Base Rate: <strong className="font-mono">₹{derivedLooseRate}</strong> /{looseName || "pc"}</>
                ) : (
                  <>Single Unit Item (1 {packName || "pc"} = 1 {looseName || "pc"})</>
                )}
              </span>
            </div>
          </div>

          {/* Persist to Master Checkbox */}
          <label className="flex items-start gap-2.5 p-3 rounded-card border border-border-main bg-canvas hover:bg-surface cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={persistMaster}
              onChange={(e) => setPersistMaster(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-btn border-border-main text-accent focus:ring-accent"
            />
            <div>
              <p className="font-semibold text-text-main text-xs">Update Product Master permanently</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Save this unit configuration (1 {packName || "pack"} = {unitsPerPack} {looseName || "pcs"}) to the product master for future bills and stock ledger.
              </p>
            </div>
          </label>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-border-main bg-canvas flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-btn border border-border-main text-xs font-semibold text-text-muted hover:text-text-main hover:bg-surface transition-colors cursor-pointer"
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-btn bg-accent text-xs font-bold text-white shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            Apply Unit & Conversion (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};
