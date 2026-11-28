import React from "react";

import { canalDoApp } from "@/lib/app/canalDoApp";

/**
 * D-PROD-381 — o selo "TESTE" no canto da tela do APK de teste: quem usa sabe que está na versão de teste (as
 * atualizações dele vêm do canal de teste, não do oficial). No app oficial e no site, nada.
 */
export default function SeloDeTeste() {
  if (canalDoApp() !== "teste") return null;
  return (
    <div
      data-testid="selo-de-teste"
      aria-label="Versão de teste"
      style={{
        position: "fixed",
        left: "50%",
        top: "calc(env(safe-area-inset-top, 0px) + 2px)",
        transform: "translateX(-50%)",
        zIndex: 2147483000,
        pointerEvents: "none",
        background: "#f97316",
        color: "#ffffff",
        font: "700 10px/1 Inter, Arial, sans-serif",
        letterSpacing: "0.08em",
        padding: "3px 8px",
        borderRadius: 999,
        boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
      }}
    >
      TESTE
    </div>
  );
}
