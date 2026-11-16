import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AvisoGestao, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { chaveTotais, totaisParaExibir } from "@/lib/atividadeLinhasRegras";
import { obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

/**
 * Totalizador FIXO no topo da atividade aberta (D-PROD-202, §5): área executada / planejada, o total de cada produto
 * (quantidade e custo), as horas ou km de cada máquina (e o custo), a mão de obra de cada funcionário por medida e
 * cada serviço (Fatia 4: quantidade e custo), o combustível dos abastecimentos ligados (D-PROD-210: L e kg à parte e
 * o custo; o custo de combustível por hectare; o consumo de cada bem, L/h ou km/L), o custo acumulado (com o
 * combustível) e o custo por hectare. Lê
 * `GET /atividades/:id/totais` (só linhas confirmadas de apontamentos confirmados); toda escrita invalida a chave
 * (`chaveTotais`) e ele se relê. Sem resposta, mostra a área do cabeçalho.
 * @param {{ atividade: any, empresaId: string|null, habilitado: boolean }} props
 */
export default function TotalizadorAtividade({ atividade, empresaId, habilitado }) {
  const id = atividade?.id ? String(atividade.id) : null;
  const consulta = useQuery({
    queryKey: chaveTotais(empresaId, id),
    queryFn: () => obterTotaisAtividade(/** @type {string} */ (id)),
    enabled: Boolean(habilitado && empresaId && id),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const t = totaisParaExibir(consulta.data ?? null, atividade);
  return (
    <div className="b1 mg-b1-form-grid sticky top-0 z-10 w-full min-h-0 bg-white" data-testid="totalizador-atividade">
      <SecaoForm titulo="Totais da atividade" />
      <ValorCalculado label="Área executada / planejada" valor={t.area} span={4} testId="totalizador-area" />
      <ValorCalculado label="Custo acumulado" valor={t.custo} span={4} testId="totalizador-custo" destaque />
      <ValorCalculado label="Custo por hectare" valor={t.custoPorHa} span={4} testId="totalizador-custo-ha" />
      {t.produtos.map((p) => (
        <ValorCalculado
          key={`p-${p.chave}`}
          label={p.nome}
          valor={p.custo ? `${p.quantidade} · ${p.custo}` : p.quantidade}
          span={4}
          testId={`totalizador-produto-${p.chave}`}
        />
      ))}
      {t.maquinas.map((m) => (
        <ValorCalculado key={`m-${m.chave}`} label={m.nome} valor={m.custo ? `${m.uso} · ${m.custo}` : m.uso} span={4} testId={`totalizador-maquina-${m.chave}`} />
      ))}
      {t.maoObra.map((o) => (
        <ValorCalculado
          key={`o-${o.chave}`}
          label={`Mão de obra — ${o.nome}`}
          valor={o.custo ? `${o.quantidade} · ${o.custo}` : o.quantidade}
          span={4}
          testId={`totalizador-mao-obra-${o.chave}`}
        />
      ))}
      {t.servicos.map((v) => (
        <ValorCalculado key={`s-${v.chave}`} label={`Serviço — ${v.nome}`} valor={v.custo ? `${v.quantidade} · ${v.custo}` : v.quantidade} span={4} testId={`totalizador-servico-${v.chave}`} />
      ))}
      {t.combustivel !== null ? <ValorCalculado label="Combustível" valor={t.combustivel} span={4} testId="totalizador-combustivel" /> : null}
      {t.custoCombustivelPorHa !== null ? (
        <ValorCalculado label="Custo de combustível por hectare" valor={t.custoCombustivelPorHa} span={4} testId="totalizador-combustivel-ha" />
      ) : null}
      {t.consumoPorBem.map((b) => (
        <ValorCalculado key={`c-${b.chave}`} label={`Consumo — ${b.nome}`} valor={b.valor} span={4} testId={`totalizador-consumo-${b.chave}`} />
      ))}
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
