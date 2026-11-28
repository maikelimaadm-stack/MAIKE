import React from "react";
import { Sprout } from "lucide-react";
import { Cartao, Celula, Chip, Grade } from "@/components/mapa/detalhes-lote/blocos";

import "@/styles/mk-dp-detalhes-v13.css";
import "@/styles/mk-dp-area-v13.css";

/*
 * Aba Detalhes da área (D-PROD-254), no desenho do Detalhes do Lote v12: o cartão da área (nome, hectares, tipo,
 * cultura/forragem, situação).
 *
 * D-PROD-383: as atividades saíram (para recomeçar do zero). Com elas saíram desta aba as atividades em andamento, a
 * reforma, o resumo de Manejos e Custos e as seções "manejos" e "custos" (D-PROD-276, D-PROD-278, D-PROD-289).
 */

/** @param {unknown} v */
const texto = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
/** Os hectares do cartão da área, com duas casas ("22,00"). @param {unknown} v */
const ha2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
};

/** Pasto, talhão ou infraestrutura, pelo uso da área. @param {any} area */
export const tipoDaAreaTexto = (area) => {
  const uso = texto(area?.tipo_cultura).toLowerCase();
  if (uso === "infraestrutura") return texto(area?.tipo_infraestrutura || area?.tipo_pastagem) || "Infraestrutura";
  if (uso === "agricultura") return "Talhão";
  return "Pasto";
};

/** @param {{ area: any, ocupada?: boolean | null }} props */
export default function AbaDetalhesDaArea({ area, ocupada = null }) {
  const cultura = texto(area.tipo_cultura) !== "Infraestrutura" ? texto(area.cultura?.nome || area.tipo_pastagem) : "";
  const situacao = ocupada === null ? null : ocupada ? "OCUPADO" : "VAZIO";
  return (
    <div className="mk-dp-area-organizada mk-dp-d13">
      <Cartao
        icone={Sprout}
        titulo={cultura || area.nome}
        sub={cultura ? "Cultura / forragem" : undefined}
        chip={situacao ? <Chip tom={ocupada ? "ok" : "neutro"} className="mk-dp-d13-status">{situacao}</Chip> : null}
        className="mk-dp-area-resumo mk-dp-d13-area"
      >
        <Grade className="mk-dp-area-superficies mk-dp-d13-grade mk-dp-d13-grade--3">
          <Celula textoAutomatico rotulo="Área (ha)" valor={ha2(area.tamanho_hectares) || "—"} />
          <Celula textoAutomatico rotulo="Tipo" valor={tipoDaAreaTexto(area).toUpperCase()} />
          {situacao ? <Celula textoAutomatico rotulo="Situação" valor={situacao} /> : null}
        </Grade>
      </Cartao>
    </div>
  );
}
