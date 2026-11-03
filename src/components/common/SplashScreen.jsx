import React from "react";
import { Loader2 } from "lucide-react";

/**
 * Tela de carregamento com a marca MAK Gestão (D-PROD-109). `logoUrl` só substitui a logo padrão.
 * @param {{ visible: boolean, logoUrl?: string }} props
 */
export default function SplashScreen({ visible, logoUrl }) {
  return (
    <div
      className={`fixed inset-0 z-[1000] flex items-center justify-center bg-white ${
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none transition-opacity duration-500"
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center justify-center">
          <img
            src={logoUrl || "/brand/mak-gestao-logo.png"}
            alt="MAK Gestão"
            className="h-40 w-40 object-contain"
          />
        </div>
        <div className="flex items-center gap-2 text-emerald-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      </div>
    </div>
  );
}