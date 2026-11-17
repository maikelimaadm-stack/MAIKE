import React from "react";
import { Beef } from "lucide-react";
import { Segmentado, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";
import { useVistaLotes } from "@/components/mapa/detalhes-lote/useEstadoLotes";
import { VistaResumo } from "@/components/mapa/detalhes-lote/VistaResumo";
import { VistaLote } from "@/components/mapa/detalhes-lote/VistaLote";
import { VistaLista } from "@/components/mapa/detalhes-lote/VistaLista";
import "@/styles/mk-dp-lotes.css";

/** @typedef {import('@/components/mapa/detalhes-lote/useEstadoLotes').Vista} Vista */

/** @type {Array<{ valor: Vista, rotulo: string }>} */
const OPCOES_VISTA = [
  { valor: "resumo", rotulo: "Resumo" },
  { valor: "lote", rotulo: "Lote" },
  { valor: "lista", rotulo: "Lista" },
];

/**
 * Aba Lotes do pasto (v12, D-PROD-218): Resumo · Lote · Lista. Abre na Lista no
 * desktop e no tablet e no Resumo no celular; a vista escolhida fica lembrada
 * por área na sessão (D5). Sem lotes, só o aviso.
 */
export function AbaLotes() {
  const { modelo, dados, modo } = usePasto();
  const [vista, setVista] = useVistaLotes(dados.areaId, modo);
  // Só anima a troca feita pelo usuário (a entrada na aba já é animada pela casca).
  const [trocou, setTrocou] = React.useState(false);

  if (!modelo?.lotes?.length) return <Vazio icone={Beef}>Nenhum lote neste pasto agora.</Vazio>;

  return (
    <>
      <Segmentado
        rotulo="Ver como"
        opcoes={OPCOES_VISTA}
        valor={vista}
        onMudar={(v) => {
          setTrocou(true);
          setVista(/** @type {Vista} */ (v));
        }}
      />
      <div key={vista} className={`mk-dp-lotes__vista${trocou ? " mk-dp-anim--troca" : ""}`}>
        {vista === "resumo" ? <VistaResumo /> : vista === "lote" ? <VistaLote /> : <VistaLista />}
      </div>
    </>
  );
}

export default AbaLotes;
