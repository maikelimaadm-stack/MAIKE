import React from "react";

export default function ToggleSwitch({ checked, disabled = false, onChange, className = "" }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={`w-8 h-4 rounded-full relative inline-block transition-colors ${checked ? "bg-green-500" : "bg-slate-300"} ${disabled ? "opacity-70 cursor-default" : "cursor-pointer"} ${className}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? "right-0.5" : "left-0.5"}`} />
    </button>
  );
}