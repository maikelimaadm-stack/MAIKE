import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useCelular } from "@/components/common/MobileSheet";
import { resumoDasAreas } from "@/lib/lancamentosDaAreaRegras";
import { listarAreasDaFazenda } from "@/services/lancamentoAtividadesService";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/** As colunas dos custos por tipo, na ordem do computador (o celular põe o Total e o R$/ha logo depois da Área). */
const COLUNAS = [
  { id: "feitaDePlanejada", rotulo: "Feita / planejada", numero: true },
  { id: "maquinas", rotulo: "Máquinas", numero: true },
  { id: "insumos", rotulo: "Insumos", numero: true },
  { id: "maoObra", rotulo: "Mão de obra", numero: true },
  { id: "servicos", rotulo: "Serviços", numero: true },
  { id: "abastecimento", rotulo: "Abastecimento", numero: true },
  { id: "total", rotulo: "Total", numero: true },
  { id: "porHa", rotulo: "R$/ha", numero: true },
];
const ORDEM_CELULAR = ["total", "porHa", "feitaDePlanejada", "maquinas", "insumos", "maoObra", "servicos", "abastecimento"];

/**
 * O Resumo das áreas (D-PROD-252): uma tabela da atividade aberta com uma linha por área — Área, Tipo (Pasto, Talhão ou Outra,
 * pelo cadastro do mapa), Feita / planejada, o custo por tipo (Máquinas, Insumos, Mão de obra, Serviços, Abastecimento), o
 * Total e o R$/ha — e a linha de total. Tudo vem do `por_area` dos totais do servidor, juntado pela área da atividade; o Tipo
 * vem de `listarAreasDaFazenda` pelo id da área (uma leitura a mais, sem mudar o servidor). Área sem lançamento mostra "—".
 * Não há coluna de Implementos: o custo do implemento já está em Máquinas. No celular continua uma tabela que rola na
 * horizontal, com o Total e o R$/ha primeiro.
 *
 * @param {{ atividade: any, totais: any, lendoTotais: boolean, empresaId: string|null, habilitado: boolean }} props
 */
export default function ResumoDasAreas({ atividade, totais, lendoTotais, empresaId, habilitado }) {
  const celular = useCelular();
  const { data: areasDoMapa = [] } = useQuery({
    // Chave própria: a da lista de filtros da tela pode ter sido lida antes de a fazenda estar definida no serviço.
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "areas-do-resumo", empresaId],
    queryFn: () => listarAreasDaFazenda(),
    enabled: Boolean(empresaId) && habilitado,
    staleTime: 30 * 1000,
  });
  const { linhas, total } = resumoDasAreas({ atividade, totais, areasDoMapa });
  const colunas = celular ? ORDEM_CELULAR.map((id) => /** @type {any} */ (COLUNAS.find((c) => c.id === id))) : COLUNAS;
  const valor = (/** @type {any} */ l, /** @type {string} */ id) => (l[id] === "—" && lendoTotais ? "…" : l[id]);
  // No computador o Tipo vem logo depois da Área; no celular (onde o Total vem primeiro) ele fica por último.
  const colunaTipo = (/** @type {any} */ l) => <td data-testid={`resumo-area-${l.id}-tipo`}>{l.tipo}</td>;

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
                {celular ? null : <th scope="col">Tipo</th>}
                {colunas.map((c) => (
                  <th key={c.id} scope="col" className={c.numero ? "is-numero" : undefined}>
                    {c.rotulo}
                  </th>
                ))}
                {celular ? <th scope="col">Tipo</th> : null}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} data-testid={`resumo-area-${l.id}`}>
                  <td className={celular ? undefined : "is-nome"} data-testid={`resumo-area-${l.id}-nome`}>
                    {l.nome}
                  </td>
                  {celular ? null : colunaTipo(l)}
                  {colunas.map((c) => (
                    <td key={c.id} className={c.numero ? "is-numero" : undefined} data-testid={`resumo-area-${l.id}-${c.id}`}>
                      {valor(l, c.id)}
                    </td>
                  ))}
                  {celular ? colunaTipo(l) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="resumo-areas-total">
                <td>Total</td>
                {celular ? null : <td />}
                {colunas.map((c) => (
                  <td key={c.id} className={c.numero ? "is-numero" : undefined} data-testid={`resumo-areas-total-${c.id}`}>
                    {valor(total, c.id)}
                  </td>
                ))}
                {celular ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className={`${NOTA} mt-2`} data-testid="resumo-areas-nota">
        O custo do implemento já está em Máquinas. R$/ha = total ÷ hectares feitos.
      </p>
    </section>
  );
}
