import React, { useId, useMemo, useState } from "react";
import { CalendarCheck, ClipboardCheck, History, Loader2, Package } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import CascaDetalhe from "@/components/mapa/detalhes-lote/CascaDetalhe";
import { Acao, Aviso, Cartao, Celula, Grade, Linha, RodapePilulas, SecaoDetalhe, TituloBloco, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { listarTodosProdutos } from "@/services/estoqueMapaService";
import { getMapaCachedData, refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { listEmpresas } from "@/services/empresaService";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import HistoricoSuplementacaoPonto from "../suplementacao/HistoricoSuplementacaoPonto";
import DetalhesDepositoSuplementacao from "./DetalhesDepositoSuplementacao";
import CochoNivel from "./CochoNivel";
import MedidorLimiteOperacional from "./MedidorLimiteOperacional";

import { formatDecimal, formatKg } from "../suplementacao/formatters";
import { MOTIVO_PESO, MOTIVO_SEM_REFERENCIA } from "../suplementacao/FarolConsumo";
import { FAROL_CONSUMO, resumoDoFechamento } from "@/domain/suplementacao/fechamentoConsumo";
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
import "@/styles/mk-dp-cocho.css";

/*
 * Detalhe do ponto de suplementação aberto pelo Mapa Geral — cocho (aqui) e
 * depósito (`DetalhesDepositoSuplementacao`) — no MESMO desenho do Detalhes do
 * Lote v12 (D-PROD-220, sobre o D-PROD-218): a casca `CascaDetalhe` publica
 * título e subtítulo no cabeçalho do diálogo, o corpo é feito das peças de
 * `detalhes-lote/blocos` e as ações ficam no rodapé de pílulas.
 *
 * D-PROD-228: o resumo mostra nível, leitura atual e cadastro. Histórico
 * abre lançamentos, total fornecido e leituras anteriores; Fechamentos abre
 * todos os períodos fechados do ponto. As duas ações seguem a permissão de
 * histórico. Dados, regras e formulários permanecem os existentes.
 *
 * Visual próprio em src/styles/mk-dp-cocho.css (o comum fica em
 * mk-detalhes-pasto.css).
 */

const ROTULO_RESTANTE_CICLO = "Restante do ciclo (estimado)";
const ROTULO_USO_LIMITE = "Uso do limite operacional";
const NOTA_LIMITE_ATUAL = "O limite é o valor configurado hoje; mudanças no cadastro não refazem lançamentos antigos.";
const NOTA_DESCONTO_DIARIO = "No dia do abastecimento, mantém o total disponível. O desconto diário começa no dia seguinte, sem considerar o horário do registro.";

/** Dias com até 1 casa ("4", "2,3"); o SSOT não arredonda. @param {number} dias */
const formatarDias = (dias) => dias.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Número pt-BR com casas fixas, ou null. @param {unknown} v @param {number} casas */
const numero = (v, casas) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) : null;

/** "R$ 1.080,00", ou null. @param {unknown} v */
const reais = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;

/** Dia da leitura ou do lançamento em dd/mm/aaaa. @param {unknown} data */
const diaBR = (data) => formatarDia(String(data ?? "").slice(0, 10));

/** @param {unknown} texto */
const minusculo = (texto) => String(texto ?? "").toLowerCase();

/** Cor do farol do consumo (D-PROD-206) nas cores do sistema; sem referência, cinza. */
const COR_DO_FAROL_CONSUMO = Object.freeze({ vermelho: COR_FAROL.vermelho, verde: COR_FAROL.verde, azul: COR_FAROL.azul });

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

/**
 * Despachante do detalhe aberto pelo marcador: depósito ou cocho. No depósito,
 * um cocho de "Pastos atendidos" (`onAbrirCocho`) abre como tela EMPILHADA na
 * mesma janela — ‹ Voltar e o Esc voltam ao depósito (D-PROD-220). O cocho
 * empilhado vale só para o depósito em que foi aberto e segue a mesma
 * permissão do marcador do mapa (`visualizar_detalhes_cochos`, "Abrir detalhes
 * de cocho / depósito"): sem ela, o depósito não oferece o toque.
 * @param {{ ponto: any, onClose?: () => void, permissions?: Record<string, any>, subtitulo?: string, subtituloDoPonto?: ((ponto: any) => string) | null }} props
 *   `subtitulo`: o local do ponto no cabeçalho (o Mapa Geral passa áreas · setor).
 *   `subtituloDoPonto`: a mesma regra para outro ponto — o cocho empilhado pelo
 *   depósito ganha "áreas · setor" como se fosse aberto pelo mapa.
 */
export default function DetalhesPontoSuplementacao({ ponto, onClose, permissions = {}, subtitulo, subtituloDoPonto = null }) {
  const [empilhado, setEmpilhado] = useState(/** @type {{ depositoId: unknown, cocho: any, anim?: "voltar" | null } | null} */ (null));
  const doDeposito = empilhado && empilhado.depositoId === ponto?.id ? empilhado : null;
  const cochoDoDeposito = doDeposito ? doDeposito.cocho : null;
  /** @param {any} cocho */
  const abrirCochoDoDeposito = (cocho) => setEmpilhado(cocho ? { depositoId: ponto?.id, cocho } : null);
  // Voltar do cocho anima a volta do depósito, como o ‹ Voltar do Detalhes do Lote.
  const voltarAoDeposito = () => setEmpilhado({ depositoId: ponto?.id, cocho: null, anim: "voltar" });

  if (normalizeText(ponto?.categoria_ponto) === "DEPOSITO") {
    if (cochoDoDeposito) {
      const subCocho = typeof subtituloDoPonto === "function" ? subtituloDoPonto(cochoDoDeposito) : undefined;
      return <DetalhesCocho ponto={cochoDoDeposito} permissions={permissions} subtitulo={subCocho || undefined} onVoltar={voltarAoDeposito} />;
    }
    const podeAbrirCocho = permissions.visualizar_detalhes_cochos !== false;
    return (
      <DetalhesDepositoSuplementacao
        deposito={ponto}
        permissions={permissions}
        onClose={onClose}
        subtitulo={subtitulo}
        onAbrirCocho={podeAbrirCocho ? abrirCochoDoDeposito : null}
        anim={doDeposito?.anim ?? null}
      />
    );
  }
  return <DetalhesCocho ponto={ponto} permissions={permissions} subtitulo={subtitulo} />;
}

/**
 * Detalhe do COCHO (D-PROD-178). O nível vem SÓ do SSOT
 * (`calcularNivelCocho`) com os mesmos insumos do marcador do mapa: todos os
 * eventos da fazenda, os pontos de suplementação ativos (cochos que dividem os
 * mesmos animais) e o dia civil no fuso da fazenda (`useDiaCivil`), que vira
 * sozinho à meia-noite. Esta tela não calcula saldo, taxa nem percentual.
 *
 * Cabeçalho: o nome do cocho e o `subtitulo` (sem ele, as áreas vinculadas).
 * Rodapé: Lançar e Leitura com `lancar_suplementacao`; Histórico com
 * `visualizar_historico_cocho` (sem a permissão, a pílula não aparece).
 * `onVoltar`: aberto por cima do depósito (tela empilhada).
 * @param {{ ponto: any, permissions: Record<string, any>, subtitulo?: string, onVoltar?: (() => void) | null }} props
 */
function DetalhesCocho({ ponto, permissions, subtitulo, onVoltar = null }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const idNivel = useId();
  const idLeitura = useId();
  const [showLancamento, setShowLancamento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [showFechamentos, setShowFechamentos] = useState(false);
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
  const ultimasLeituras = useMemo(() => leiturasDoPonto(leituras, ponto?.id), [leituras, ponto?.id]);

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
  const eventosDoPonto = useMemo(
    () => eventos.filter((evento) => String(evento?.ponto_suplementacao_id) === String(ponto?.id)),
    [eventos, ponto?.id],
  );
  const fechamentos = useMemo(() => eventosDoPonto
    .filter((evento) => Number(evento?.dias_periodo) > 0)
    .slice()
    .sort((a, b) => String(b.data_lancamento ?? "").localeCompare(String(a.data_lancamento ?? "")) || String(b.created_date ?? "").localeCompare(String(a.created_date ?? ""))), [eventosDoPonto]);

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

  // Duração e reposição atuais vêm da mesma projeção do SSOT usada pelo Histórico.
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

  const podeLancar = permissions.lancar_suplementacao !== false;
  const podeHistorico = permissions.visualizar_historico_cocho !== false;
  // Aberto por cima do depósito, a tela entra empurrando (como as telas empilhadas do lote).
  const casca = {
    titulo: String(ponto?.nome_ponto ?? ""),
    sub: subtitulo || areaNomesRelacionadas.join(", "),
    onVoltar,
    chaveTela: "cocho",
    anim: onVoltar ? /** @type {const} */ ("empurrar") : null,
  };

  if (loadingInicial) {
    return (
      <CascaDetalhe {...casca}>
        <Vazio icone={Loader2} className="mk-dp-cocho__carregando" role="status">Carregando detalhes do cocho...</Vazio>
      </CascaDetalhe>
    );
  }

  /** @type {Array<{ chave: string, rotulo: string, icone: import("lucide-react").LucideIcon, onClick: () => void }>} */
  const pilulas = [];
  if (podeLancar) {
    pilulas.push({ chave: "lancar", rotulo: "Lançar", icone: Package, onClick: () => setShowLancamento(true) });
    pilulas.push({ chave: "leitura", rotulo: "Leitura", icone: ClipboardCheck, onClick: () => setShowLeitura(true) });
  }
  if (podeHistorico) {
    pilulas.push({ chave: "fechamentos", rotulo: "Fechamentos", icone: CalendarCheck, onClick: () => setShowFechamentos(true) });
    pilulas.push({ chave: "historico", rotulo: "Histórico", icone: History, onClick: () => setShowHistorico(true) });
  }

  return (
    <>
      <CascaDetalhe {...casca} className="mk-dp-cocho mk-dp--suplementacao-organizada" rodape={pilulas.length ? <RodapePilulas itens={pilulas} rotulo="Ações do cocho" /> : null}>
        <section aria-labelledby={idNivel} className="mk-dp-cocho__regiao">
          <h3 id={idNivel} className="mk-dp-cocho__oculto">Nível do cocho</h3>
          <BlocoNivel nivel={nivel} />
          <CartaoDoNivel nivel={nivel} duracaoCicloDias={duracaoCicloDias} proximaReposicao={proximaReposicao} />
        </section>

        <section aria-labelledby={idLeitura} className="mk-dp-cocho__regiao mk-dp-secao mk-dp-cocho__leitura">
          <TituloBloco id={idLeitura}>Leitura do cocho</TituloBloco>
          <PainelLeitura farol={farol} ultimas={[]} podeExcluir={false} onExcluir={excluirLeitura} />
        </section>

        <SecaoDetalhe titulo="Informações do cocho">
        <Cartao>
          <Grade>
            <Celula rotulo="Número" valor={ponto.numero_ponto || "-"} />
            <Celula rotulo="Sigla" valor={ponto.sigla || "-"} />
            <Celula rotulo="Tipo" valor={ponto.tipo || "-"} />
            <Celula rotulo="Depósito vinculado" valor={ponto.deposito_origem_nome || "-"} />
            <Celula rotulo="Áreas vinculadas" valor={areaNomesRelacionadas.join(", ") || "-"} />
            <Celula rotulo="Produto padrão" valor={ponto.produto_padrao || "-"} />
            {ponto.metragem_cocho_m ? <Celula rotulo="Metragem" valor={`${formatDecimal(ponto.metragem_cocho_m)} m`} /> : null}
            {ponto.cobertura_cocho ? <Celula rotulo="Cobertura" valor={ponto.cobertura_cocho} /> : null}
            <Celula rotulo="Consumo ideal/cab" valor={ponto.consumo_ideal_por_cabeca_kg ? `${formatDecimal(ponto.consumo_ideal_por_cabeca_kg, 3)} kg` : "-"} />
            <Celula rotulo="Consumo mín./cab/dia" valor={ponto.limite_minimo_consumo ? `${formatDecimal(ponto.limite_minimo_consumo, 3)} kg` : "-"} />
            <Celula rotulo="Consumo máx./cab/dia" valor={ponto.limite_maximo_consumo ? `${formatDecimal(ponto.limite_maximo_consumo, 3)} kg` : "-"} />
            <Celula rotulo="Dias alerta reposição" valor={ponto.dias_alerta_reposicao ? `${formatDecimal(ponto.dias_alerta_reposicao, 0, true)} dia(s)` : "-"} />
            <Celula rotulo="Alerta sem lançamento" valor={ponto.alerta_sem_lancamento_dias ? `${formatDecimal(ponto.alerta_sem_lancamento_dias, 0, true)} dia(s)` : "-"} />
          </Grade>
          <Linha rotulo="Observações" valor={ponto.observacoes || "-"} quebra />
        </Cartao>
        </SecaoDetalhe>
      </CascaDetalhe>

      {/* Lançar no desenho do lançamento de manejo (D-PROD-222): título = a ação, subtítulo = o cocho; o ✓ do cabeçalho envia. */}
      <LancLoteDialogo open={showLancamento} onOpenChange={setShowLancamento} titulo="Lançar Suplementação" lotes={[{ nome: ponto.nome_ponto }]} largo>
        {showLancamento ? (
          <FormularioLancamentoSuplementacao
            ponto={ponto}
            cicloCompartilhado={nivel.confiabilidade === "compartilhada"}
            onCancel={() => {
              setShowLancamento(false);
              handleSaved();
            }}
          />
        ) : null}
      </LancLoteDialogo>

      <LancLoteDialogo open={showLeitura} onOpenChange={setShowLeitura} titulo="Leitura de Cocho" lotes={[{ nome: ponto.nome_ponto }]}>
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

      <LancLoteDialogo open={showFechamentos} onOpenChange={setShowFechamentos} titulo="Fechamentos do Cocho" lotes={ponto.nome_ponto ? [{ nome: ponto.nome_ponto }] : undefined} largo somenteLeitura>
        {showFechamentos ? (
          <CascaDetalhe titulo="Fechamentos do Cocho" sub={ponto.nome_ponto} className="mk-dp-cocho">
            {fechamentos.length ? (
              <ul className="mk-dp-cocho__fechamentos" aria-label="Fechamentos do cocho">
                {fechamentos.map((evento) => (
                  <li key={evento.id}>
                    <CartaoPeriodoFechado evento={evento} resumo={resumoDoFechamento(evento)} />
                  </li>
                ))}
              </ul>
            ) : <Vazio icone={CalendarCheck}>Nenhum período fechado ainda.</Vazio>}
          </CascaDetalhe>
        ) : null}
      </LancLoteDialogo>

      <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico de Suplementação" lotes={ponto.nome_ponto ? [{ nome: ponto.nome_ponto }] : undefined} largo somenteLeitura>
          {showHistorico ? (
            <div className="mk-dp mk-dp-cocho__historico">
        <SecaoDetalhe titulo="Total fornecido por produto" className="mk-dp-cocho__produtos">
        <Cartao>
          {resumoProdutos.length === 0 ?
          <Linha className="mk-dp-cocho__linha--fraca" rotulo="Nenhum produto lançado ainda." /> :
          resumoProdutos.map((item) =>
          <Linha
            key={item.produto ?? ""}
            rotulo={item.produto || "-"}
            valor={`${item.sacos.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos · ${formatKg(item.kg)}`} />
          )}
        </Cartao>

        </SecaoDetalhe>


              <SecaoDetalhe titulo="Leituras do cocho">
                <PainelLeitura farol={farol} ultimas={ultimasLeituras} podeExcluir={podeLancar} onExcluir={excluirLeitura} mostrarResumo={false} />
              </SecaoDetalhe>
              <HistoricoSuplementacaoPonto pontoId={ponto.id} pontoNome={ponto.nome_ponto} ponto={ponto} nivel={nivel} />
            </div>
          ) : null}
        </LancLoteDialogo>
    </>);

}

/**
 * Bloco do nível do ciclo (o `v11-nivel` do v12): o subícone do cocho (o
 * desenho dos detalhes, sem a bolinha do mapa, D-PROD-225) com o nível do
 * SSOT, "RESTANTE DO CICLO (ESTIMADO)", o percentual UMA vez, grande
 * (sem estimativa, o estado: "Período fechado", "Sem lançamento"…), e as linhas
 * (kg, consumo, dias). Neutro (sem estimativa, período fechado, sem
 * lançamento…) mostra a mensagem do estado e, quando há, o que fazer para a
 * estimativa voltar e a base do ciclo.
 *
 * Mesma marcação e classes do `Nivel` de blocos.jsx, com uma diferença: lá a
 * figura é sempre decorativa (`aria-hidden`); aqui o `CochoNivel` é o
 * `role="img"` "Restante do ciclo (estimado): …" (D-PROD-178) — o leitor de
 * tela ouve o nível por ele, e o rótulo e o valor visíveis (o mesmo texto)
 * saem da árvore acessível para não serem lidos duas vezes.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho }} props
 */
function BlocoNivel({ nivel }) {
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

  /** @type {Array<string|null>} */
  const linhas = estimado ?
  [
    `Base do ciclo: ${formatarKgNivel(/** @type {number} */ (nivel.baseCicloKg))}`,
    `Consumo estimado: ${formatarTaxaNivel(/** @type {number} */ (nivel.taxaConsumoKgDia))} (${nivel.evento?.base_consumo === "G_CAB_DIA" ? "g/cab/dia" : "%PV"} no lançamento)`,
    nivel.diasDecorridos != null && nivel.diasRestantesEstimados != null ?
    `Dias desde o abastecimento: ${nivel.diasDecorridos} · Restam ${formatarDias(nivel.diasRestantesEstimados)} dia(s)` :
    null] :

  [
    mensagem,
    orientacao,
    baseSemEstimativa ?
    nivel.sobraAnteriorKg ?
    `No início do ciclo: ${formatarKgNivel(/** @type {number} */ (nivel.baseCicloKg))} (${formatarKgNivel(nivel.fornecidoKg ?? 0)} fornecidos + ${formatarKgNivel(nivel.sobraAnteriorKg)} de sobra anterior)` :
    `No início do ciclo: ${formatarKgNivel(/** @type {number} */ (nivel.baseCicloKg))} fornecidos` :
    null];


  return (
    <div className={nivel.neutro ? "mk-dp-nivel mk-dp-cocho__nivel mk-dp-cocho__nivel--neutro" : "mk-dp-nivel mk-dp-cocho__nivel"}>
      <span className="mk-dp-nivel__fig mk-dp-cocho__fig">
        <CochoNivel percent={nivel.fracaoParaSvg} neutro={nivel.neutro} rotuloNeutro={nivel.rotuloCurto} label={ROTULO_RESTANTE_CICLO} />
      </span>
      <div className="mk-dp-nivel__txt">
        <span className="mk-dp-nivel__rot" aria-hidden="true">{ROTULO_RESTANTE_CICLO}</span>
        <strong className="mk-dp-nivel__val" aria-hidden="true">{nivel.rotuloCurto}</strong>
        {linhas.filter(Boolean).map((linha, i) =>
        <small key={i} className="mk-dp-nivel__linha">{linha}</small>
        )}
        {estimado ? <small className="mk-dp-nivel__linha mk-dp-cocho__obs">{NOTA_DESCONTO_DIARIO}</small> : null}
      </div>
    </div>);

}

/**
 * Cartão abaixo do nível (o v12 mostra só com estimativa; aqui sempre, porque o
 * limite operacional tem estado próprio): uso do LIMITE OPERACIONAL configurado
 * hoje (percentual bruto, pode passar de 100%; neutro com a mensagem e o que
 * fazer), o saldo (estimado, ou a sobra informada no fechamento — sem
 * estimativa, nada é chamado de saldo), a duração do ciclo e a próxima
 * reposição; depois, a linha "No lançamento" e a nota de que o limite é o de hoje.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho, duracaoCicloDias: number|null, proximaReposicao: string|null }} props
 */
function CartaoDoNivel({ nivel, duracaoCicloDias, proximaReposicao }) {
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
  const nota = limite != null && nivel.evento ? NOTA_LIMITE_ATUAL : null;

  return (
    <Cartao className="mk-dp-cocho__cartao-nivel">
      <Grade>
        <MedidorLimiteOperacional
          estilo="v12"
          percentualBruto={uso ? nivel.ocupacaoAtualPercentual : null}
          rotulo={ROTULO_USO_LIMITE}
          descricao={descricao}
          textoAcessivel={uso?.textoAcessivel}
          orientacao={limite == null ? MENSAGENS_NIVEL.orientacaoLimite : null} />
        {nivel.saldoKg != null && nivel.saldoTipo ?
        <Celula
          rotulo={nivel.saldoTipo === "informado" ? "Sobra informada" : "Saldo estimado"}
          valor={formatarKgNivel(nivel.saldoKg)} /> :
        null}
        {duracaoCicloDias != null ? <Celula rotulo="Duração estimada" valor={`${formatarDias(duracaoCicloDias)} dia(s)`} /> : null}
        {proximaReposicao ? <Celula rotulo="Próxima reposição" valor={proximaReposicao} /> : null}
      </Grade>
      {linhaLancamento ?
      <Linha rotulo={<span className={nivel.excessoNoLancamentoKg ? "mk-dp-cocho__atencao" : undefined}>{linhaLancamento}</span>} sub={nota} /> :
      nota ?
      <Linha className="mk-dp-cocho__linha--fraca" rotulo={nota} /> :
      null}
    </Cartao>);

}

/**
 * D-PROD-205 — leitura do cocho como no v12: a primeira linha é o farol da
 * última leitura (cor + rótulo, escore · acesso · estrutura, data e quem leu);
 * no Histórico, a lista completa (mais recente primeiro), cada uma com o
 * "Excluir"; os avisos de acesso/estrutura da última leitura vêm abaixo do cartão.
 * @param {{ farol: import("@/domain/suplementacao/leituraCocho").FarolCocho, ultimas: any[], podeExcluir: boolean, onExcluir: (l: any) => void, mostrarResumo?: boolean }} props
 */
function PainelLeitura({ farol, ultimas, podeExcluir, onExcluir, mostrarResumo = true }) {
  const l = farol.leitura;
  const diaDaUltima = l ? diaBR(l.data_leitura) : "";
  return (
    <>
      <Cartao data-testid="painel-leitura-cocho">
        {mostrarResumo ? <Linha
          rotulo={<span data-testid="farol-cocho" data-cor={farol.cor}>{farol.rotulo}</span>}
          sub={l ?
          `Escore ${minusculo(ROTULO_ESCORE[l.escore] ?? l.escore)} · acesso ${minusculo(ROTULO_ACESSO[l.acesso] ?? l.acesso)} · estrutura ${minusculo(ROTULO_ESTRUTURA[l.estrutura] ?? l.estrutura)}` :
          "Nenhuma leitura registrada."}
          bolinha={COR_FAROL[farol.cor]}
          valor={l ? `${diaDaUltima}${l.registrado_por_nome ? ` · ${l.registrado_por_nome}` : ""}` : "—"} /> : null}
        {ultimas.length > 0 ?
        <ul className="mk-dp-cocho__leituras" aria-label="Últimas leituras">
            {ultimas.map((u) => {
            const dia = diaBR(u.data_leitura);
            return (
              <li key={u.id}>
                  {/* A bolinha vai junto do texto (não na `bolinha` da Linha): sem espaço, só o "Excluir" desce.
                      A observação (texto livre, às vezes longo) fica embaixo, na largura toda. */}
                  <Linha
                  className={u.observacoes ? "mk-dp-cocho__linha--fraca mk-dp-cocho__linha--com-obs" : "mk-dp-cocho__linha--fraca"}
                  rotulo={dia}
                  valor={
                  <>
                        <span className="mk-dp-cocho__escore">
                          <span className="mk-dp-bolinha" style={{ background: corDoEscore(u) }} aria-hidden="true" />
                          {[u.escore, u.acesso, u.estrutura].map((v) => String(v ?? "—").toUpperCase()).join(" · ")}
                        </span>
                        {podeExcluir ?
                    <Acao tom="perigo" onClick={() => onExcluir(u)} aria-label={`Excluir a leitura de ${dia}`}>
                            Excluir
                          </Acao> :
                    null}
                      </>
                  } />
                  {u.observacoes ? <p className="mk-dp-cocho__obs-leitura">{u.observacoes}</p> : null}
                </li>);

          })}
          </ul> :
        null}
      </Cartao>
      {mostrarResumo ? farol.avisos.map((a) =>
      <Aviso key={a.texto} data-testid="aviso-leitura-cocho">{`${a.texto} (leitura de ${diaDaUltima})`}</Aviso>
      ) : null}
      {!mostrarResumo && !ultimas.length ? <Vazio icone={ClipboardCheck}>Nenhuma leitura registrada.</Vazio> : null}
    </>);

}

/**
 * Cor do escore de UMA leitura: o farol no próprio dia dela (idade 0), para a
 * regra escore → cor ficar só no domínio (`farolDoCocho`).
 * @param {any} leitura
 */
const corDoEscore = (leitura) =>
  farolDoCocho({ leituras: [leitura], pontoId: leitura?.ponto_suplementacao_id, hoje: String(leitura?.data_leitura ?? "").slice(0, 10) }).hex;

/**
 * D-PROD-206 — o período FECHADO mais recente no desenho do v12: produto,
 * lançamento e dias, real × esperado com a cor e o texto do farol, custo por
 * cabeça/dia e, no mesmo desenho, o resto do resumo de hoje (consumo g/cab/dia,
 * % do esperado, peso médio do período, custo do período, sobra antiga e o
 * aviso de sobra não informada). Na base g/cab/dia (D-PROD-210) a comparação é
 * em gramas e o %PV real é só informação.
 * @param {{ evento: any, resumo: ReturnType<typeof resumoDoFechamento> }} props
 */
function CartaoPeriodoFechado({ evento, resumo }) {
  if (!evento || !resumo) {
    return (
      <Cartao>
        <Linha className="mk-dp-cocho__linha--fraca" rotulo="Nenhum período fechado ainda." />
      </Cartao>);

  }
  const farol = FAROL_CONSUMO[resumo.farol_consumo] ?? FAROL_CONSUMO.sem_referencia;
  const corFarol = COR_DO_FAROL_CONSUMO[farol.cor] ?? COR_FAROL.cinza;
  const semReferencia = resumo.farol_consumo === "sem_referencia";
  const motivo = semReferencia && resumo.farol_consumo_motivo ? MOTIVO_SEM_REFERENCIA[resumo.farol_consumo_motivo] : null;
  const faixa = numero(resumo.faixa_tolerancia_aplicada, 0);
  // O texto sempre acompanha a cor (D-PROD-206): "abaixo da faixa da formulação (±15%)".
  const textoFarol = semReferencia ?
  `${minusculo(farol.rotulo)}${motivo ? ` — ${motivo}` : ""}` :
  `${minusculo(farol.rotulo)} da faixa da formulação${faixa ? ` (±${faixa}%)` : ""}`;
  const subFarol = <span data-testid="farol-consumo" data-farol={resumo.farol_consumo}>{textoFarol}</span>;

  const emGramas = resumo.base_consumo_aplicada === "G_CAB_DIA";
  const pvReal = numero(resumo.consumo_real_pv_percentual, 3);
  const pvEsperado = numero(resumo.consumo_esperado_pv_percentual, 3);
  const gReal = numero(resumo.consumo_g_cab_dia, 0);
  const gMeta = numero(resumo.consumo_esperado_g_cab_dia, 0);
  const relacaoPct = typeof resumo.consumo_relacao_esperado === "number" ? resumo.consumo_relacao_esperado * 100 : null;
  const motivoPeso = resumo.peso_medio_periodo_motivo ? MOTIVO_PESO[resumo.peso_medio_periodo_motivo] : null;
  const sobraHerdada = typeof resumo.sobra_herdada_kg === "number" && resumo.sobra_herdada_kg > 0 && typeof resumo.custo_sobra_herdada_kg === "number";

  return (
    <Cartao data-testid="ultimo-periodo-fechado">
      <Grade>
        <Celula rotulo="Produto" valor={evento.produto || "-"} />
        <Celula rotulo="Lançamento" valor={`${diaBR(evento.data_lancamento)} · ${evento.dias_periodo} dia(s)`} />
        {emGramas ?
        <Celula rotulo="g/cab/dia real × meta" valor={gReal ? `${gReal} g × ${gMeta ? `${gMeta} g` : "-"}` : "-"} bolinha={corFarol} sub={subFarol} /> :
        <Celula rotulo="%PV real × esperado" valor={pvReal ? `${pvReal}% × ${pvEsperado ? `${pvEsperado}%` : "-"}` : "-"} bolinha={corFarol} sub={subFarol} />
        }
        <Celula rotulo="Custo por cab/dia (R$)" valor={numero(resumo.custo_cab_dia, 2) ?? "Sem custo"} />
        {emGramas ?
        <Celula rotulo="%PV real (informação)" valor={pvReal ? `${pvReal}%` : "-"} /> :
        <Celula rotulo="Consumo g/cab/dia" valor={gReal ? `${gReal} g` : "-"} />
        }
        {relacaoPct !== null ? <Celula rotulo="% do esperado" valor={`${numero(relacaoPct, 0)}%`} /> : null}
        {typeof resumo.peso_medio_periodo_kg === "number" ?
        <Celula
          rotulo="Peso médio do período"
          valor={`${numero(resumo.peso_medio_periodo_kg, 0)} kg`}
          sub={resumo.peso_medio_periodo_aproximado ? <span className="mk-dp-cocho__atencao">{`aproximado${motivoPeso ? `: ${motivoPeso}` : ""}`}</span> : null}
          data-testid="peso-medio-periodo" /> :
        null}
        <Celula
          rotulo="Custo do período"
          valor={reais(resumo.custo_total_periodo) ? `${reais(resumo.custo_total_periodo)} · ${reais(resumo.custo_unitario_kg)}/kg` : "Sem custo"} />
        {sobraHerdada ?
        <Celula
          rotulo="Sobra antiga primeiro"
          valor={`${numero(resumo.sobra_herdada_kg, 2)} kg a ${reais(resumo.custo_sobra_herdada_kg)}/kg`}
          sub={resumo.custo_sobra_aproximado ? <span className="mk-dp-cocho__atencao">custo da sobra aproximado</span> : null}
          data-testid="custo-sobra-herdada" /> :
        null}
      </Grade>
      {resumo.sobra_informada === false ?
      <Linha className="mk-dp-cocho__linha--atencao" rotulo="Aproximado — sobra não informada" data-testid="fechamento-aproximado" /> :
      null}
    </Cartao>);

}
