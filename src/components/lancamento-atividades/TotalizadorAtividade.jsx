import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AvisoGestao, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { chaveTotais, totaisParaExibir } from "@/lib/atividadeLinhasRegras";
import TabelaBase1 from "@/components/lancamento-atividades/TabelaBase1";
import { useVerCusto } from "@/components/lancamento-atividades/VerCusto";
import { obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

const COLUNAS_DOS_ITENS = [
  { id: "tipo", label: "Tipo", sortable: true, width: 130 },
  { id: "item", label: "Item", sortable: true, width: 280 },
  { id: "quantidade", label: "Quantidade", sortable: true, align: "right", width: 130 },
  { id: "custo", label: "Custo", sortable: true, align: "right", width: 130 },
];

/**
 * Totalizador FIXO no topo da atividade aberta (D-PROD-202, §5): área executada / planejada, o total de cada produto
 * (quantidade e custo), as horas ou km de cada máquina (e o custo), a mão de obra de cada funcionário por medida e
 * cada serviço (Fatia 4: quantidade e custo), o combustível dos abastecimentos ligados (D-PROD-211: L e kg à parte e
 * o custo; o custo de combustível por hectare; o consumo de cada bem, L/h ou km/L), o custo acumulado (com o
 * combustível) e o custo por hectare. Lê
 * `GET /atividades/:id/totais` (só linhas confirmadas de apontamentos confirmados); toda escrita invalida a chave
 * (`chaveTotais`) e ele se relê. Sem resposta, mostra a área do cabeçalho.
 * Emenda 2 da D-PROD-252: os produtos, as máquinas, a mão de obra e os serviços saem numa tabela Base1 (Tipo, Item,
 * Quantidade, Custo), não mais um campo por item; os valores únicos (área, custo, combustível e consumo) continuam campos do detalhe.
 * D-PROD-234: na aba "Resumo da atividade" ele não fica preso ao topo (`fixo={false}`).
 * @param {{ atividade: any, empresaId: string|null, habilitado: boolean, fixo?: boolean }} props
 */
export default function TotalizadorAtividade({ atividade, empresaId, habilitado, fixo = true }) {
  const id = atividade?.id ? String(atividade.id) : null;
  const consulta = useQuery({
    queryKey: chaveTotais(empresaId, id),
    queryFn: () => obterTotaisAtividade(/** @type {string} */ (id)),
    enabled: Boolean(habilitado && empresaId && id),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const verCusto = useVerCusto();
  const t = totaisParaExibir(consulta.data ?? null, atividade);
  // O que foi gasto por item: uma tabela Base1 (Tipo, Item, Quantidade, Custo) em vez de um campo por item.
  const itens = [
    ...t.produtos.map((p) => ({ id: `produto-${p.chave}`, tipo: "Insumo", item: p.nome, quantidade: p.quantidade, custo: p.custo })),
    ...t.maquinas.map((m) => ({ id: `maquina-${m.chave}`, tipo: "Máquina", item: m.nome, quantidade: m.uso, custo: m.custo })),
    ...t.maoObra.map((o) => ({ id: `mao-obra-${o.chave}`, tipo: "Mão de obra", item: o.nome, quantidade: o.quantidade, custo: o.custo })),
    ...t.servicos.map((v) => ({ id: `servico-${v.chave}`, tipo: "Serviço", item: v.nome, quantidade: v.quantidade, custo: v.custo })),
  ];
  const TEXTO = /** @type {Record<string, (i: any) => string>} */ ({ tipo: (i) => i.tipo, item: (i) => i.item, quantidade: (i) => i.quantidade || "—", custo: (i) => i.custo || "—" });
  return (
    <div className={`b1 mg-b1-form-grid w-full min-h-0 bg-white${fixo ? " sticky top-0 z-10" : ""}`} data-testid="totalizador-atividade">
      <SecaoForm titulo="Totais da atividade" />
      <ValorCalculado label="Área executada / planejada" valor={t.area} span={4} testId="totalizador-area" />
      {verCusto ? <ValorCalculado label="Custo acumulado" valor={t.custo} span={4} testId="totalizador-custo" destaque /> : null}
      {verCusto ? <ValorCalculado label="Custo por hectare" valor={t.custoPorHa} span={4} testId="totalizador-custo-ha" /> : null}
      {verCusto && t.combustivel !== null ? <ValorCalculado label="Combustível" valor={t.combustivel} span={4} testId="totalizador-combustivel" /> : null}
      {verCusto && t.custoCombustivelPorHa !== null ? (
        <ValorCalculado label="Custo de combustível por hectare" valor={t.custoCombustivelPorHa} span={4} testId="totalizador-combustivel-ha" />
      ) : null}
      {t.consumoPorBem.map((b) => (
        <ValorCalculado key={`c-${b.chave}`} label={`Consumo — ${b.nome}`} valor={b.valor} span={4} testId={`totalizador-consumo-${b.chave}`} />
      ))}
      {itens.length ? (
        <div className="col-span-12 min-w-0 pb-2">
          <TabelaBase1
            solta
            testId="totalizador-itens"
            chave="lancamento-atividade-totais-itens"
            colunas={verCusto ? COLUNAS_DOS_ITENS : COLUNAS_DOS_ITENS.filter((c) => c.id !== "custo")}
            linhas={itens}
            valorDoCampo={(i, id) => TEXTO[id](i)}
            renderCelula={(i, id) =>
              id === "quantidade" || id === "custo" ? <span data-testid={id === "quantidade" ? `totalizador-${i.id}` : `totalizador-${i.id}-custo`}>{TEXTO[id](i)}</span> : TEXTO[id](i)
            }
          />
        </div>
      ) : null}
      {consulta.isError ? (
        <div className="col-span-12">
          <AvisoGestao testId="totalizador-erro">
            Não foi possível ler os totais das linhas (produtos, máquinas, mão de obra, serviços e combustível) agora.{" "}
            <button type="button" className="underline" onClick={() => consulta.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      ) : null}
    </div>
  );
}
