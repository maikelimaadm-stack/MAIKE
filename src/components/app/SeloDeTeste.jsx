import React, { useEffect, useState } from "react";

import { canalDoApp } from "@/lib/app/canalDoApp";

/**
 * D-PROD-381 — o selo "TESTE" no canto da tela do APK de teste: quem usa sabe que está na versão de teste (as
 * atualizações dele vêm do canal de teste, não do oficial). No app oficial e no site, nada.
 *
 * D-PROD-382: o selo mostra também o número da atualização de teste que está rodando ("TESTE 3"), para conferir no
 * celular que a última chegou.
 */
export const numeroDoTeste = (versao) => {
  const m = /^teste-[0-9a-f]+-(\d+)$/.exec(String(versao || ""));
  return m ? m[1] : null;
};

export default function SeloDeTeste() {
  const teste = canalDoApp() === "teste";
  const [numero, setNumero] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    if (!teste) return undefined;
    let vivo = true;
    fetch("/app-versao.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => vivo && setNumero(numeroDoTeste(v?.versao)))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [teste]);
  // D-PROD-382: "· chão" = este APK desenha os nomes no chão do mapa (sem isso, falta instalar o APK de teste novo)
  const [chao, setChao] = useState(false);
  useEffect(() => {
    if (!teste) return undefined;
    const ligar = () => setChao(true);
    window.addEventListener("maike:nomes-no-chao", ligar);
    return () => window.removeEventListener("maike:nomes-no-chao", ligar);
  }, [teste]);
  if (!teste) return null;
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
      {numero ? `TESTE ${numero}` : "TESTE"}
      {chao ? " · chão" : ""}
    </div>
  );
}
