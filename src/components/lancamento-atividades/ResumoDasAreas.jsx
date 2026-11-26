import React from "react";
import { useCelular } from "@/components/common/MobileSheet";
import TabelaBase1 from "@/components/lancamento-atividades/TabelaBase1";
import { resumoDasAreas } from "@/lib/lancamentosDaAreaRegras";
import { useVerCusto } from "@/components/lancamento-atividades/VerCusto";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/** As colunas, na ordem do computador (o celular põe o Total e o R$/ha logo depois da Área). */
const COLUNAS = [
  { id: "nome", label: "Área", sortable: true, width: 200 },
  { id: "ha", label: "ha", sortable: true, align: "right", width: 130 },
  { id: "maquinas", label: "Máquinas", sortable: true, align: "right", width: 120 },
  { id: "insumos", label: "Insumos", sortable: true, align: "right", width: 120 },
  { id: "maoObra", label: "Mão de obra", sortable: true, align: "right", width: 120 },
  { id: "servicos", label: "Serviços", sortable: true, align: "right", width: 120 },
  { id: "abastecimento", label: "Abastecimento", sortable: true, align: "right", width: 130 },
  { id: "total", label: "Total", sortable: true, align: "right", width: 120 },
  { id: "porHa", label: "R$/ha", sortable: true, align: "right", width: 110 },
];
const ORDEM_CELULAR = ["nome", "total", "porHa", "ha", "maquinas", "insumos", "maoObra", "servicos", "abastecimento"];

/**
 * O Resumo das áreas (D-PROD-252, emendas 1 e 2): UMA tabela Base1 da atividade aberta (`TabelaBase1`, a grade da lista), com
 * uma linha por área — Área, ha, Máquinas, Insumos, Mão de obra, Serviços, Abastecimento, Total e R$/ha — e o total no
 * rodapé da tabela. Tudo vem do `por_area` dos totais do servidor, juntado pela área da atividade; zero ou sem valor mostra
 * "—". Sem cartão, sem coluna de implemento (o custo dele já está em Máquinas) e sem nota.
 *
 * @param {{ atividade: any, totais: any, lendoTotais: boolean }} props
 */
export default function ResumoDasAreas({ atividade, totais, lendoTotais }) {
  const celular = useCelular();
  const { linhas, total } = resumoDasAreas({ atividade, totais });
  const verCusto = useVerCusto();
  const colunasDaTela = celular ? ORDEM_CELULAR.map((id) => /** @type {any} */ (COLUNAS.find((c) => c.id === id))) : COLUNAS;
  // Sem permissão de ver R$ (operador), só Área e ha: as demais colunas são todas em reais.
  const colunas = verCusto ? colunasDaTela : colunasDaTela.filter((c) => c.id === "nome" || c.id === "ha");
  const valor = (/** @type {any} */ l, /** @type {string} */ id) => (l[id] === "—" && lendoTotais ? "…" : l[id]);

  return (
    <section className="b1-tabela-tela" aria-label="Resumo das áreas" data-testid="resumo-das-areas">
      {linhas.length === 0 ? (
        <p className={NOTA} data-testid="resumo-areas-vazio">
          Esta atividade não tem áreas.
        </p>
      ) : (
        <TabelaBase1
          testId="resumo-areas-tabela"
          chave="lancamento-atividade-resumo-areas"
          colunas={colunas}
          linhas={linhas}
          valorDoCampo={valor}
          renderCelula={(l, id) => <span data-testid={`resumo-area-${l.id}-${id}`}>{valor(l, id)}</span>}
          rodape={(ids, comSelecao) => (
            <tr data-testid="resumo-areas-total">
              {comSelecao ? <td /> : null}
              {ids.map((id) => (
                <td key={id} className={id === "nome" ? undefined : "text-right tabular-nums"}>
                  {id === "nome" ? "Total" : <span data-testid={`resumo-areas-total-${id}`}>{valor(total, id)}</span>}
                </td>
              ))}
            </tr>
          )}
        />
      )}
    </section>
  );
}
