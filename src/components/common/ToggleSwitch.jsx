import React from "react";

export default function ToggleSwitch({ checked, disabled = false, onChange, className = "" }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={`!h-4 !w-8 rounded-full relative inline-flex items-center transition-colors border-0 shadow-none ${checked ? "bg-green-500 hover:bg-green-600" : "bg-slate-300 hover:bg-slate-400"} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? "right-0.5" : "left-0.5"}`} />
    </button>
  );
}