import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import React, { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listarTodosProdutos } from "@/services/estoqueMapaService";
import { getMapaCachedData, refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { listEmpresas } from "@/services/empresaService";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import HistoricoSuplementacaoPonto from "../suplementacao/HistoricoSuplementacaoPonto";
import DetalhesDepositoSuplementacao from "./DetalhesDepositoSuplementacao";
import CochoNivel from "./CochoNivel";
import MedidorLimiteOperacional from "./MedidorLimiteOperacional";

import { formatDecimal, formatKg } from "../suplementacao/formatters";
import CardMetricaEvento from "../suplementacao/CardMetricaEvento";
import { ResumoFechamentoConsumo } from "../suplementacao/FarolConsumo";
import { resumoDoFechamento } from "@/domain/suplementacao/fechamentoConsumo";
import FormularioLeituraCocho from "../suplementacao/FormularioLeituraCocho";
import { excluirLeituraCocho } from "@/services/leituraCochoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { confirmarExclusao } from "@/lib/maikeConfirmar";
import { notifyError, notifySuccess } from "@/lib/maikeNotify";
import {
  COR_FAROL,
  ROTULO_ACESSO,
  ROTULO_ESCORE,
  ROTULO_ESTRUTURA,
  farolDoCocho,
  leiturasDoPonto,
} from "@/domain/suplementacao/leituraCocho";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { kgParaSacos } from "../suplementacao/unidadeConversaoUtils";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { useDiaCivil } from "@/hooks/useDiaCivil";
import { formatarDia } from "@/lib/diaCivil";
import {
  MENSAGENS_NIVEL,
  calcularNivelCocho,
  descreverUsoDoLimite,
  formatarKgNivel,
  projecaoDoCartaoDoNivel,
  formatarPercentualNivel,
  formatarTaxaNivel,
} from "@/domain/suplementacao/nivelSuplementacao";

const ROTULO_RESTANTE_CICLO = "Restante do ciclo (estimado)";
const ROTULO_USO_LIMITE = "Uso do limite operacional";
const NOTA_LIMITE_ATUAL = "O limite é o valor configurado hoje; mudanças no cadastro não refazem lançamentos antigos.";

/** Dias com até 1 casa ("4", "2,3"); o SSOT não arredonda. @param {number} dias */
const formatarDias = (dias) => dias.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/**
 * Leitura do cache local do mapa (rápida), com atualização em segundo plano.
 * Usa a MESMA chave do React Query do Mapa Geral (`['mapa-cache', chave,
 * empresa, 'default']`, ver `createMapaQuery`): o detalhe calcula o nível com
 * os mesmos arrays de eventos e pontos do marcador (D-PROD-178 §1) e recebe as
 * mesmas invalidações — uma chave própria ficava velha depois de um cadastro.
 * @param {string} chave capacidade do `mapaCacheService`
 * @param {string|null} empresaId
 * @param {number} staleTime
 */
function useCacheDoMapa(chave, empresaId, staleTime) {
  const queryClient = useQueryClient();
  const queryKey = ['mapa-cache', chave, empresaId, 'default'];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const cached = await getMapaCachedData(chave, empresaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry(chave, empresaId).then((fresh) => {
            if (fresh?.length) queryClient.setQueryData(queryKey, fresh);
          }).catch(() => {});
          return cached;
        }
        return (await refreshMapaCacheEntry(chave, empresaId)) || [];
      }
      return cached || [];
    },
    enabled: !!empresaId,
    staleTime,
  });
}

export default function DetalhesPontoSuplementacao({ ponto, onClose, permissions = {} }) {
  if (normalizeText(ponto?.categoria_ponto) === "DEPOSITO") {
    return <DetalhesDepositoSuplementacao deposito={ponto} permissions={permissions} onClose={onClose} />;
  }
  return <DetalhesCocho ponto={ponto} permissions={permissions} />;
}

/**
 * Detalhe do COCHO (D-PROD-178). O nível vem SÓ do SSOT
 * (`calcularNivelCocho`) com os mesmos insumos do marcador do mapa: todos os
 * eventos da fazenda, os pontos de suplementação ativos (cochos que dividem os
 * mesmos animais) e o dia civil no fuso da fazenda (`useDiaCivil`), que vira
 * sozinho à meia-noite. Esta tela não calcula saldo, taxa nem percentual.
 */
function DetalhesCocho({ ponto, permissions }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const [showLancamento, setShowLancamento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [showLeitura, setShowLeitura] = useState(false);

  // Fuso da FAZENDA: o mesmo resumo de empresas do Layout (`['empresas']`).
  // Sem fuso, o dia é o do relógio do navegador (`useDiaCivil(null)`).
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresas) ? empresas : []).find((e) => String(e?.id) === String(empresaSelecionadaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresas, empresaSelecionadaId]);
  const hoje = useDiaCivil(fuso);

  // Eventos de TODOS os pontos da fazenda: o SSOT olha o último evento dos
  // outros cochos para detectar compartilhamento.
  const { data: eventos = [], isLoading: loadingEventos } = useCacheDoMapa("eventosSuplementacao", empresaSelecionadaId, 60 * 1000);
  const { data: pontosSuplementacao = [], isLoading: loadingPontos } = useCacheDoMapa("pontosSuplementacao", empresaSelecionadaId, 5 * 60 * 1000);
  const { data: areas = [], isLoading: loadingAreas } = useCacheDoMapa("areas", empresaSelecionadaId, 5 * 60 * 1000);
  // D-PROD-205: leituras de cocho (o farol), do mesmo cache do mapa.
  const { data: leituras = [] } = useCacheDoMapa("leiturasCocho", empresaSelecionadaId, 60 * 1000);
  const farol = useMemo(() => farolDoCocho({ leituras, pontoId: ponto?.id, hoje }), [leituras, ponto?.id, hoje]);
  const ultimasLeituras = useMemo(() => leiturasDoPonto(leituras, ponto?.id).slice(0, 5), [leituras, ponto?.id]);

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-ponto-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      if (!navigator.onLine) {
        // Se estiver offline, retorna o que tiver na Query Cache do TanStack ou vazio
        return [];
      }
      const all = await listarTodosProdutos();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const nivel = useMemo(
    () => calcularNivelCocho({ ponto, eventos, hoje, pontos: pontosSuplementacao }),
    [ponto, eventos, hoje, pontosSuplementacao],
  );
  const ultimoEvento = nivel.evento;
  const eventosDoPonto = useMemo(
    () => eventos.filter((evento) => String(evento?.ponto_suplementacao_id) === String(ponto?.id)),
    [eventos, ponto?.id],
  );
  // D-PROD-206: o período FECHADO mais recente do cocho (pela data do lançamento; empate, o último da lista).
  const ultimoFechado = useMemo(() => {
    const fechados = eventosDoPonto.filter((evento) => Number(evento?.dias_periodo) > 0);
    return fechados.reduce((maisNovo, evento) => (!maisNovo || String(evento.data_lancamento ?? "") >= String(maisNovo.data_lancamento ?? "") ? evento : maisNovo), null);
  }, [eventosDoPonto]);
  const resumoUltimoFechado = useMemo(() => (ultimoFechado ? resumoDoFechamento(ultimoFechado) : null), [ultimoFechado]);

  const areaIdsRelacionadas = Array.isArray(ponto.area_vinculada_ids) && ponto.area_vinculada_ids.length > 0 ?
  ponto.area_vinculada_ids :
  ponto.area_vinculada_id ?
  [ponto.area_vinculada_id] :
  [];
  const areaNomesRelacionadas = useMemo(() => {
    const nomesPorId = new Map(areas.map((area) => [area.id, area.nome]));
    const nomesPorIds = areaIdsRelacionadas.map((id) => nomesPorId.get(id)).filter(Boolean);
    if (nomesPorIds.length > 0) return nomesPorIds;
    if (Array.isArray(ponto.area_vinculada_nomes) && ponto.area_vinculada_nomes.length > 0) return ponto.area_vinculada_nomes.filter(Boolean);
    return ponto.area_vinculada_nome ? [ponto.area_vinculada_nome] : [];
  }, [areas, areaIdsRelacionadas, ponto.area_vinculada_nomes, ponto.area_vinculada_nome]);
  const ultimoProduto = useMemo(() => {
    if (!ultimoEvento?.produto) return null;
    return produtos.find((produto) => normalizeText(produto.nome_produto || "") === normalizeText(ultimoEvento.produto || "")) || null;
  }, [produtos, ultimoEvento]);
  const ultimoEventoSacos = useMemo(() => {
    const pesoPorSaco = Number(ultimoProduto?.peso_por_saco_kg || 0);
    if (!ultimoEvento || pesoPorSaco <= 0) return null;
    return kgParaSacos(ultimoEvento.quantidade_total_kg || 0, pesoPorSaco);
  }, [ultimoProduto, ultimoEvento]);
  const resumoProdutos = useMemo(() => {
    const mapa = new Map();
    eventosDoPonto.forEach((evento) => {
      const produto = produtos.find((item) => normalizeText(item.nome_produto || "") === normalizeText(evento.produto || ""));
      const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
      const atual = mapa.get(evento.produto) || { produto: evento.produto, kg: 0, sacos: 0 };
      atual.kg += Number(evento.quantidade_total_kg || 0);
      atual.sacos += pesoPorSaco > 0 ? kgParaSacos(evento.quantidade_total_kg || 0, pesoPorSaco) : 0;
      mapa.set(evento.produto, atual);
    });
    return Array.from(mapa.values()).sort((a, b) => (a.produto || "").localeCompare(b.produto || ""));
  }, [eventosDoPonto, produtos]);

  // "Último registro" e Histórico: a MESMA projeção do SSOT. No ciclo aberto,
  // taxa/duração/reposição do nível (null = sem estimativa confiável); fora
  // dele (período fechado, futuro, data inválida) o cartão usa o gravado no
  // evento — a comparação real × esperado do fechamento não é projeção.
  const projecaoCartao = projecaoDoCartaoDoNivel(nivel);
  const duracaoCicloDias = projecaoCartao.duracaoEstimada ?? null;
  const proximaReposicao = projecaoCartao.proximaReposicao ?? null;

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["eventos-ponto", "mapa-eventos-supl", "mapa-pontos-supl", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  /** D-PROD-205: depois de registrar/excluir leitura, o detalhe e o marcador releem o cache. */
  const leiturasAtualizadas = (lista) => {
    if (Array.isArray(lista)) queryClient.setQueryData(["mapa-cache", "leiturasCocho", empresaSelecionadaId, "default"], lista);
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "mapa-cache" && query.queryKey[1] === "leiturasCocho" });
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["leiturasCocho"] } }));
  };

  const excluirLeitura = async (leitura) => {
    const ok = await confirmarExclusao(`Excluir a leitura de ${formatarDia(String(leitura.data_leitura).slice(0, 10))} (${ROTULO_ESCORE[leitura.escore] ?? leitura.escore})?`);
    if (!ok) return;
    try {
      await excluirLeituraCocho(leitura.id);
      const lista = await updateMapaCachedData("leiturasCocho", empresaSelecionadaId, (itens) => (itens || []).filter((i) => i.id !== leitura.id));
      leiturasAtualizadas(lista);
      notifySuccess("Leitura excluída");
    } catch (erro) {
      notifyError("Erro ao excluir a leitura", getApiErrorMessage(erro));
    }
  };

  // Aguarda a leitura rápida do cache local (os pontos entram: sem eles o
  // compartilhamento entre cochos não seria detectado no primeiro quadro).
  const loadingInicial = (loadingEventos && eventos.length === 0) || (loadingAreas && areas.length === 0) || (loadingPontos && pontosSuplementacao.length === 0);

  if (loadingInicial) {
    return (
      <div className="mk-map-details space-y-1" translate="no">
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando detalhes do cocho...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mk-map-details space-y-1" translate="no">
      <div className="pb-1 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {ponto.nome_ponto}</Badge>
        </div>
      </div>

      <div className={permissions.lancar_suplementacao !== false ? "grid grid-cols-3 gap-1" : "grid grid-cols-2 gap-1"}>
        {permissions.lancar_suplementacao !== false && <Button data-mk-map-action="" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamento(true)}>Lançar</Button>}
        {permissions.lancar_suplementacao !== false && <Button data-mk-map-action="" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLeitura(true)}>Leitura</Button>}
        {permissions.visualizar_historico_cocho !== false && <Button data-mk-map-action="" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>}
      </div>

      <CardSection title="Nível do cocho" regiao>
        {/* Celular: um medidor embaixo do outro; a partir de 768 px, lado a lado. */}
        <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
          <PainelRestanteCiclo nivel={nivel} />
          <PainelUsoLimite nivel={nivel} />
        </div>
        <CartoesNivel nivel={nivel} duracaoCicloDias={duracaoCicloDias} proximaReposicao={proximaReposicao} />
      </CardSection>

      <CardSection title="Leitura do cocho" regiao>
        <PainelLeitura farol={farol} ultimas={ultimasLeituras} podeExcluir={permissions.lancar_suplementacao !== false} onExcluir={excluirLeitura} />
      </CardSection>

      <CardSection title="Último período fechado">
        {ultimoFechado && resumoUltimoFechado ?
        <div className="space-y-1" data-testid="ultimo-periodo-fechado">
            <div className="text-[10px] text-slate-500">
              {ultimoFechado.produto || "-"} · {formatarDia(String(ultimoFechado.data_lancamento ?? "").slice(0, 10))} · {ultimoFechado.dias_periodo} dia(s)
            </div>
            <ResumoFechamentoConsumo resumo={resumoUltimoFechado} />
          </div> :
        <div className="text-xs text-slate-500">Nenhum período fechado ainda.</div>
        }
      </CardSection>

      <CardSection title="Total Fornecido por Produto">
        {resumoProdutos.length === 0 ?
        <div className="text-xs text-slate-500">Nenhum produto lançado ainda.</div> :

        <div className="space-y-1">
            {resumoProdutos.map((item) =>
          <div key={item.produto} className="rounded-lg border border-slate-200 bg-[#FAFCFE] px-2 py-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                  <div className="truncate font-medium text-slate-900">{item.produto}</div>
                  <div className="whitespace-nowrap font-semibold text-slate-900">{item.sacos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos</div>
                  <div className="whitespace-nowrap font-semibold text-slate-900">{formatKg(item.kg)}</div>
                </div>
              </div>
          )}
          </div>
        }
      </CardSection>

      <CardSection title="Último Registro">
        {ultimoEvento ?
        <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-1 text-[11px] space-y-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 break-words font-semibold leading-tight text-slate-900">{ultimoEvento.produto}</div>
              <span className="shrink-0 text-slate-500 px-1">Data: {formatarDia(nivel.dataLancamento)}</span>
            </div>
            <CardMetricaEvento
            evento={ultimoEvento}
            sacos={ultimoEventoSacos}
            showProjecao={true}
            {...projecaoCartao} />
            {ultimoEvento.observacoes && <div className="break-words text-[10px] italic text-slate-500">{ultimoEvento.observacoes}</div>}
          </div> :
        <div className="text-xs text-slate-500">Nenhum lançamento ainda.</div>
        }
      </CardSection>

      <CardSection title="Informações do Cocho">
        <div className="space-y-1 text-[10px]">
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Número:</span><span className="font-semibold text-slate-900">{ponto.numero_ponto || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Sigla:</span><span className="font-semibold text-slate-900">{ponto.sigla || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Tipo:</span><span className="font-semibold text-slate-900">{ponto.tipo || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Depósito vinculado:</span><span className="font-semibold text-slate-900">{ponto.deposito_origem_nome || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Áreas vinculadas:</span><span className="font-semibold text-slate-900">{areaNomesRelacionadas.join(', ') || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Produto padrão:</span><span className="font-semibold text-slate-900">{ponto.produto_padrao || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Limite operacional:</span><span className="font-semibold text-slate-900">{nivel.limiteOperacionalKg != null ? formatKg(nivel.limiteOperacionalKg) : '-'}</span></div>
          {ponto.metragem_cocho_m && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Metragem:</span><span className="font-semibold text-slate-900">{formatDecimal(ponto.metragem_cocho_m)} m</span></div>}
          {ponto.cobertura_cocho && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cobertura:</span><span className="font-semibold text-slate-900">{ponto.cobertura_cocho}</span></div>}
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Consumo ideal/cab:</span><span className="font-semibold text-slate-900">{ponto.consumo_ideal_por_cabeca_kg ? `${formatDecimal(ponto.consumo_ideal_por_cabeca_kg, 3)} kg` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Consumo mín./cab/dia:</span><span className="font-semibold text-slate-900">{ponto.limite_minimo_consumo ? `${formatDecimal(ponto.limite_minimo_consumo, 3)} kg` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Consumo máx./cab/dia:</span><span className="font-semibold text-slate-900">{ponto.limite_maximo_consumo ? `${formatDecimal(ponto.limite_maximo_consumo, 3)} kg` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Dias alerta reposição:</span><span className="font-semibold text-slate-900">{ponto.dias_alerta_reposicao ? `${formatDecimal(ponto.dias_alerta_reposicao, 0, true)} dia(s)` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Alerta sem lançamento:</span><span className="font-semibold text-slate-900">{ponto.alerta_sem_lancamento_dias ? `${formatDecimal(ponto.alerta_sem_lancamento_dias, 0, true)} dia(s)` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Observações:</span><span className="font-semibold text-slate-900 break-words">{ponto.observacoes || '-'}</span></div>
        </div>
      </CardSection>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}>
        <DialogContent className="mk-map-dialog max-w-[880px] max-h-[90vh] overflow-y-auto overflow-x-hidden"><FormularioLancamentoSuplementacao ponto={ponto} cicloCompartilhado={nivel.confiabilidade === "compartilhada"} onCancel={() => {setShowLancamento(false);handleSaved();}} /></DialogContent>
      </Dialog>

      <LancLoteDialogo open={showLeitura} onOpenChange={setShowLeitura} titulo="Leitura de Cocho">
        {showLeitura ? (
          <FormularioLeituraCocho
            ponto={ponto}
            hoje={hoje}
            onCancel={() => setShowLeitura(false)}
            onSaved={async () => {
              setShowLeitura(false);
              leiturasAtualizadas(await getMapaCachedData("leiturasCocho", empresaSelecionadaId));
            }}
          />
        ) : null}
      </LancLoteDialogo>

      <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico de Suplementação" largo somenteLeitura>
          <HistoricoSuplementacaoPonto pontoId={ponto.id} pontoNome={ponto.nome_ponto} ponto={ponto} nivel={nivel} />
        </LancLoteDialogo>
    </div>);

}

/**
 * Medidor 1 — quanto resta do ciclo aberto (fração do SSOT). O percentual
 * aparece uma vez, sob o ícone (`CochoNivel`); a linha de baixo traz os kg.
 * Neutro (sem estimativa, período fechado, sem lançamento…) mostra a mensagem
 * do estado e, quando há, o que fazer para a estimativa voltar.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho }} props
 */
function PainelRestanteCiclo({ nivel }) {
  const estimado = nivel.confiabilidade === "estimada" && !nivel.neutro && nivel.saldoKg != null && nivel.baseCicloKg != null;
  const mensagem = nivel.confiabilidade === "indisponivel" && nivel.motivo ? `${nivel.mensagem}: ${nivel.motivo}.` : nivel.mensagem;
  const baseSemEstimativa = !estimado && nivel.estado === "ciclo_aberto" && nivel.baseCicloKg != null && nivel.baseCicloKg > 0;
  const orientacao = nivel.confiabilidade === "compartilhada" ?
  MENSAGENS_NIVEL.orientacaoCompartilhada :
  nivel.confiabilidade === "indisponivel" && nivel.motivo === MENSAGENS_NIVEL.motivoSemPv
    ? MENSAGENS_NIVEL.orientacaoSemPv
    : nivel.confiabilidade === "indisponivel" && nivel.motivo === MENSAGENS_NIVEL.motivoSemPeso
      ? MENSAGENS_NIVEL.orientacaoSemPeso
      : null;

  return (
    <div className="flex min-w-0 flex-col items-center gap-1 rounded-lg border border-slate-200 bg-[#FAFCFE] p-2">
      <div className="self-stretch text-[10px] font-medium text-slate-500">{ROTULO_RESTANTE_CICLO}</div>
      <CochoNivel percent={nivel.fracaoParaSvg} neutro={nivel.neutro} rotuloNeutro={nivel.rotuloCurto} label={ROTULO_RESTANTE_CICLO} />
      {estimado ?
      <div className="space-y-0.5 text-center text-[11px] leading-snug text-slate-700">
          <div className="font-semibold text-slate-900">{`${formatarKgNivel(nivel.saldoKg)} de ${formatarKgNivel(nivel.baseCicloKg)}`}</div>
          <div>{`Consumo estimado: ${formatarTaxaNivel(nivel.taxaConsumoKgDia)} (${nivel.evento?.base_consumo === "G_CAB_DIA" ? "g/cab/dia" : "%PV"} no lançamento)`}</div>
          {nivel.diasDecorridos != null && nivel.diasRestantesEstimados != null &&
        <div>{`Dias desde o abastecimento: ${nivel.diasDecorridos} · Restam ${formatarDias(nivel.diasRestantesEstimados)} dia(s)`}</div>
        }
          <p className="max-w-[320px] text-[10px] text-slate-500">No dia do abastecimento, mantém o total disponível. O desconto diário começa no dia seguinte, sem considerar o horário do registro.</p>
        </div> :
      <div className="space-y-0.5 text-center text-[11px] leading-snug text-slate-600">
          <p className="max-w-[320px] break-words">{mensagem}</p>
          {orientacao && <p className="max-w-[320px] break-words text-[10px] text-slate-500">{orientacao}</p>}
          {baseSemEstimativa &&
        <p className="text-[10px] text-slate-500">
              {nivel.sobraAnteriorKg ?
          `No início do ciclo: ${formatarKgNivel(nivel.baseCicloKg)} (${formatarKgNivel(nivel.fornecidoKg ?? 0)} fornecidos + ${formatarKgNivel(nivel.sobraAnteriorKg)} de sobra anterior)` :
          `No início do ciclo: ${formatarKgNivel(nivel.baseCicloKg)} fornecidos`}
            </p>
        }
        </div>
      }
    </div>);

}

/**
 * Medidor 2 — uso do LIMITE OPERACIONAL configurado hoje. Percentual bruto
 * (pode passar de 100%); a barra só preenche até 100%. A linha "No
 * lançamento" fica visível depois do consumo.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho }} props
 */
function PainelUsoLimite({ nivel }) {
  const limite = nivel.limiteOperacionalKg;
  // Mesmo padrão de texto do depósito (`descreverUsoDoLimite`).
  const uso = limite != null && nivel.ocupacaoAtualPercentual != null && nivel.saldoKg != null ?
  descreverUsoDoLimite({ percentual: nivel.ocupacaoAtualPercentual, saldoKg: nivel.saldoKg, limiteKg: limite, excessoKg: nivel.excessoAtualKg }) :
  null;
  const descricao = uso ? uso.descricao : limite != null ?
  `Sem estimativa do que há no cocho agora (limite de ${formatarKgNivel(limite)}).` :
  MENSAGENS_NIVEL.limiteNaoConfigurado;
  const linhaLancamento = nivel.ocupacaoNoLancamentoPercentual != null ?
  `No lançamento: ${formatarPercentualNivel(nivel.ocupacaoNoLancamentoPercentual)}${nivel.excessoNoLancamentoKg ? ` (${formatarKgNivel(nivel.excessoNoLancamentoKg)} acima)` : ""}` :
  null;

  return (
    <div className="flex min-w-0 flex-col justify-center gap-1.5 rounded-lg border border-slate-200 bg-[#FAFCFE] p-2">
      <MedidorLimiteOperacional
        percentualBruto={uso ? nivel.ocupacaoAtualPercentual : null}
        rotulo={ROTULO_USO_LIMITE}
        descricao={descricao}
        textoAcessivel={uso?.textoAcessivel}
        orientacao={limite == null ? MENSAGENS_NIVEL.orientacaoLimite : null} />
      {linhaLancamento && <div className={`text-[11px] ${nivel.excessoNoLancamentoKg ? "font-medium text-amber-800" : "text-slate-700"}`}>{linhaLancamento}</div>}
      {limite != null && nivel.evento && <p className="text-[10px] leading-snug text-slate-500">{NOTA_LIMITE_ATUAL}</p>}
    </div>);

}

/**
 * Cartões do SSOT: saldo (estimado ou a sobra informada no fechamento),
 * duração do ciclo e próxima reposição. Sem estimativa, nada é chamado de saldo.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho, duracaoCicloDias: number|null, proximaReposicao: string|null }} props
 */
function CartoesNivel({ nivel, duracaoCicloDias, proximaReposicao }) {
  /** @type {Array<{ rotulo: string, valor: string, detalhe?: string }>} */
  const cartoes = [];
  if (nivel.saldoKg != null && nivel.saldoTipo) {
    cartoes.push({
      rotulo: nivel.saldoTipo === "informado" ? "Sobra informada" : "Saldo estimado",
      valor: formatarKgNivel(nivel.saldoKg),
      detalhe: nivel.saldoTipo === "estimado" && nivel.taxaConsumoKgDia != null ? formatarTaxaNivel(nivel.taxaConsumoKgDia) : undefined,
    });
  }
  if (duracaoCicloDias != null) cartoes.push({ rotulo: "Duração estimada", valor: `${formatarDias(duracaoCicloDias)} dia(s)` });
  if (proximaReposicao) cartoes.push({ rotulo: "Próxima reposição", valor: proximaReposicao });
  if (!cartoes.length) return null;

  return (
    <div className="grid grid-cols-1 gap-1 text-[10px] sm:grid-cols-3">
      {cartoes.map((cartao) =>
      <div key={cartao.rotulo} className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2.5">
          <div className="text-slate-500">{cartao.rotulo}</div>
          <div className="text-sm font-bold text-slate-900">{cartao.valor}</div>
          {cartao.detalhe && <div className="text-[11px] text-slate-600 mt-0.5">{cartao.detalhe}</div>}
        </div>
      )}
    </div>);

}

/**
 * D-PROD-205 — farol da última leitura (cor + rótulo + data e quem leu), os avisos
 * de acesso/estrutura e as últimas leituras (até 5), com excluir.
 * @param {{ farol: import("@/domain/suplementacao/leituraCocho").FarolCocho, ultimas: any[], podeExcluir: boolean, onExcluir: (l: any) => void }} props
 */
function PainelLeitura({ farol, ultimas, podeExcluir, onExcluir }) {
  const l = farol.leitura;
  return (
    <div className="space-y-1 text-[11px]" data-testid="painel-leitura-cocho">
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-block h-3 w-3 rounded-full border border-white shadow" style={{ backgroundColor: COR_FAROL[farol.cor] }} />
        <span className="font-semibold text-slate-900" data-testid="farol-cocho" data-cor={farol.cor}>{farol.rotulo}</span>
        {l ? <span className="text-slate-500">· {formatarDia(String(l.data_leitura).slice(0, 10))}{l.registrado_por_nome ? ` · ${l.registrado_por_nome}` : ""}</span> : null}
      </div>
      {l ? (
        <div className="text-slate-600">
          Escore: <span className="font-semibold text-slate-900">{ROTULO_ESCORE[l.escore] ?? l.escore}</span>
          {" · "}Acesso: <span className="font-semibold text-slate-900">{ROTULO_ACESSO[l.acesso] ?? l.acesso}</span>
          {" · "}Estrutura: <span className="font-semibold text-slate-900">{ROTULO_ESTRUTURA[l.estrutura] ?? l.estrutura}</span>
        </div>
      ) : (
        <div className="text-slate-500">Nenhuma leitura registrada.</div>
      )}
      {farol.avisos.map((a) => (
        <div key={a.texto} className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800" data-testid="aviso-leitura-cocho">
          {a.texto} (leitura de {formatarDia(String(l.data_leitura).slice(0, 10))})
        </div>
      ))}
      {ultimas.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200" aria-label="Últimas leituras">
          {ultimas.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 px-2 py-0.5">
              <span className="text-slate-700">
                {formatarDia(String(u.data_leitura).slice(0, 10))} · {ROTULO_ESCORE[u.escore] ?? u.escore}
                {u.acesso === "RUIM" ? " · acesso ruim" : ""}
                {u.estrutura !== "BOA" ? ` · ${String(ROTULO_ESTRUTURA[u.estrutura] ?? u.estrutura).toLowerCase()}` : ""}
                {u.observacoes ? <span className="italic text-slate-500"> · {u.observacoes}</span> : null}
              </span>
              {podeExcluir ? (
                <button type="button" className="shrink-0 text-red-600 hover:underline" onClick={() => onExcluir(u)} aria-label={`Excluir a leitura de ${formatarDia(String(u.data_leitura).slice(0, 10))}`}>
                  Excluir
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * @param {{ title: string, regiao?: boolean, children: React.ReactNode }} props
 *   `regiao`: vira `<section>` nomeada pelo título (região acessível).
 */
function CardSection({ title, regiao = false, children }) {
  const idTitulo = useId();
  const classes = "border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1";
  const cabecalho = <div id={regiao ? idTitulo : undefined} className="text-[11px] font-bold text-slate-900">{title}</div>;
  if (regiao) {
    return (
      <section aria-labelledby={idTitulo} className={classes}>
        {cabecalho}
        {children}
      </section>);

  }
  return (
    <div className={classes}>
      {cabecalho}
      {children}
    </div>);

}
