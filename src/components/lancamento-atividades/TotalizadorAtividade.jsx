import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AvisoGestao, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { chaveTotais, totaisParaExibir } from "@/lib/atividadeLinhasRegras";
import { obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

/**
 * Totalizador FIXO no topo da atividade aberta (D-PROD-201, §5): área executada / planejada, o total de cada produto
 * (quantidade e custo), as horas ou km de cada máquina (e o custo), o custo acumulado e o custo por hectare. Lê
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
      {consulta.isError ? (
        <div className="col-span-12">
          <AvisoGestao testId="totalizador-erro">
            Não foi possível ler os totais de produtos e máquinas agora.{" "}
            <button type="button" className="underline" onClick={() => consulta.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      ) : null}
    </div>
  );
}
