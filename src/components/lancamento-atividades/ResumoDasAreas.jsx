import React from "react";
import { useCelular } from "@/components/common/MobileSheet";
import { resumoDasAreas } from "@/lib/lancamentosDaAreaRegras";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/** As colunas depois da Área, na ordem do computador (o celular põe o Total e o R$/ha logo depois da Área). */
const COLUNAS = [
  { id: "ha", rotulo: "ha" },
  { id: "maquinas", rotulo: "Máquinas" },
  { id: "insumos", rotulo: "Insumos" },
  { id: "maoObra", rotulo: "Mão de obra" },
  { id: "servicos", rotulo: "Serviços" },
  { id: "abastecimento", rotulo: "Abastecimento" },
  { id: "total", rotulo: "Total" },
  { id: "porHa", rotulo: "R$/ha" },
];
const ORDEM_CELULAR = ["total", "porHa", "ha", "maquinas", "insumos", "maoObra", "servicos", "abastecimento"];

/**
 * O Resumo das áreas (D-PROD-252, emenda): UMA tabela da atividade aberta, no estilo das outras (`b1-tipo-tabela`), com uma
 * linha por área — Área, ha, Máquinas, Insumos, Mão de obra, Serviços, Abastecimento, Total e R$/ha — e a linha de total.
 * Tudo vem do `por_area` dos totais do servidor, juntado pela área da atividade; zero ou sem valor mostra "—". Sem coluna
 * de implemento (o custo dele já está em Máquinas) e sem nota. No celular continua uma tabela que rola na horizontal, com a
 * Área, o Total e o R$/ha primeiro.
 *
 * @param {{ atividade: any, totais: any, lendoTotais: boolean }} props
 */
export default function ResumoDasAreas({ atividade, totais, lendoTotais }) {
  const celular = useCelular();
  const { linhas, total } = resumoDasAreas({ atividade, totais });
  const colunas = celular ? ORDEM_CELULAR.map((id) => /** @type {any} */ (COLUNAS.find((c) => c.id === id))) : COLUNAS;
  const valor = (/** @type {any} */ l, /** @type {string} */ id) => (l[id] === "—" && lendoTotais ? "…" : l[id]);

  return (
    <section className="b1-aba-cartao b1-aberta-cartao" aria-labelledby="resumo-areas-t" data-testid="resumo-das-areas">
      <div className="b1-aba-cartao__cab b1-aberta-cartao__cab">
        <h3 className="b1-aba-cartao__titulo" id="resumo-areas-t">
          Resumo das áreas
        </h3>
      </div>
      {linhas.length === 0 ? (
        <p className={NOTA} data-testid="resumo-areas-vazio">
          Esta atividade não tem áreas.
        </p>
      ) : (
        <div className="b1-tipo-tabela__rolagem">
          <table className="b1-tipo-tabela" data-testid="resumo-areas-tabela">
            <thead>
              <tr>
                <th scope="col">Área</th>
                {colunas.map((c) => (
                  <th key={c.id} scope="col" className="is-numero">
                    {c.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} data-testid={`resumo-area-${l.id}`}>
                  <td className={celular ? undefined : "is-nome"} data-testid={`resumo-area-${l.id}-nome`}>
                    {l.nome}
                  </td>
                  {colunas.map((c) => (
                    <td key={c.id} className="is-numero" data-testid={`resumo-area-${l.id}-${c.id}`}>
                      {valor(l, c.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="resumo-areas-total">
                <td>Total</td>
                {colunas.map((c) => (
                  <td key={c.id} className="is-numero" data-testid={`resumo-areas-total-${c.id}`}>
                    {valor(total, c.id)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
