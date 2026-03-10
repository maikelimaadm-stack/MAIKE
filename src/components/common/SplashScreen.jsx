import React from "react";
import { Loader2 } from "lucide-react";

export default function SplashScreen({ visible, logoUrl }) {
  return (
    <div
      className={`fixed inset-0 z-[1000] flex items-center justify-center bg-white transition-opacity duration-500 ${
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center justify-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo"
              className="h-20 w-20 object-contain"
            />
          ) : (
            <div className="h-20 w-20 rounded-md bg-emerald-600 text-white flex items-center justify-center text-lg font-bold">
              M
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-emerald-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      </div>
    </div>
  );
}