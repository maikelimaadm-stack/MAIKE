import React, { useId, useMemo, useState } from "react";
import { CalendarCheck, ClipboardCheck, History, Loader2 } from "lucide-react";
import IconeLancarSuplementacao from "./IconeLancarSuplementacao";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import CascaDetalhe from "@/components/mapa/detalhes-lote/CascaDetalhe";
import FiltroHistorico from "@/components/mapa/detalhes-lote/FiltroHistorico";
import CancelarLancamentoCocho, { usePermissaoCancelarCocho } from "@/components/suplementacao/CancelarLancamentoCocho";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import { Abas, Acao, Aviso, Cartao, Celula, Grade, Linha, RodapePilulas, SecaoDetalhe, TituloBloco, Vazio, idsDaAba } from "@/components/mapa/detalhes-lote/blocos";
import { VAZIO, fmtNumero, rotuloDoDia } from "@/components/mapa/detalhes-lote/historicoDoPasto";
import { listarTodosProdutos } from "@/services/estoqueMapaService";
import { getMapaCachedData, refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { listEmpresas } from "@/services/empresaService";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import DetalhesDepositoSuplementacao from "./DetalhesDepositoSuplementacao";
import CochoNivel from "./CochoNivel";

import { formatDecimal } from "../suplementacao/formatters";
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
  formatarKgNivel,
  projecaoDoCartaoDoNivel,
  formatarPercentualNivel,
  formatarTaxaNivel,
} from "@/domain/suplementacao/nivelSuplementacao";
import "@/styles/mk-dp-cocho.css";
import "@/styles/mk-dp-historico.css";

const FILTROS_COCHO = [
  { valor: "todos", rotulo: "Todos os registros" },
  { valor: "lancamentos", rotulo: "Lançamentos" },
  { valor: "leituras", rotulo: "Leituras" },
];

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
  const idBaseAbas = `cocho-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [abaAtiva, setAbaAtiva] = useState(/** @type {"detalhes" | "fechamentos" | "informacoes" | "historico"} */ ("detalhes"));
  const [animAba, setAnimAba] = useState(/** @type {"aba-dir" | "aba-esq" | null} */ (null));
  const [filtroHistorico, setFiltroHistorico] = useState("todos");
  const [showLancamento, setShowLancamento] = useState(false);
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
  const pesoPorSacoCiclo = useMemo(() => {
    const nome = normalizeText(nivel.evento?.produto || ponto?.produto_padrao || "");
    if (!nome) return 0;
    const prod = produtos.find((item) => normalizeText(item.nome_produto || "") === nome);
    return Number(prod?.peso_por_saco_kg || 0);
  }, [produtos, nivel.evento?.produto, ponto?.produto_padrao]);
  const saldoSacos = pesoPorSacoCiclo > 0 && nivel.saldoKg != null ? kgParaSacos(nivel.saldoKg, pesoPorSacoCiclo) : null;
  const consumoSacosDia = pesoPorSacoCiclo > 0 && nivel.taxaConsumoKgDia != null ? kgParaSacos(nivel.taxaConsumoKgDia, pesoPorSacoCiclo) : null;
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

  // D-PROD-267: sem a permissão de cancelar, o cartão do cocho fica sem pé.
  const { autorizado: podeCancelarCocho } = usePermissaoCancelarCocho();
  const diasEventosCocho = useMemo(() => {
    const ordenados = eventosDoPonto
      .slice()
      .sort(
        (a, b) =>
          String(b?.data_lancamento ?? "").localeCompare(String(a?.data_lancamento ?? "")) ||
          String(b?.created_date ?? "").localeCompare(String(a?.created_date ?? "")),
      );
    /** @type {Array<{ chave: string, dia: string | null, rotulo: string, cartoes: Array<{ chave: string, dia: string | null, Icone: import("lucide-react").LucideIcon, titulo: string, linhas: Array<{ rotulo: string, valor: string }>, acoes?: React.ReactNode }> }>} */
    const dias = [];
    // D-PROD-267: "Cancelar lançamento" só no lançamento mais recente do cocho (dica; o servidor decide).
    const ultimoId = podeCancelarCocho ? ordenados[0]?.id ?? null : null;
    ordenados.forEach((ev) => {
      const diaRaw = String(ev?.data_lancamento ?? "").slice(0, 10);
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(diaRaw) ? diaRaw : null;
      const produto = produtos.find((item) => normalizeText(item.nome_produto || "") === normalizeText(ev?.produto || ""));
      const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
      const qtdKg = Number(ev?.quantidade_total_kg || 0);
      const sacos = pesoPorSaco > 0 ? kgParaSacos(qtdKg, pesoPorSaco) : 0;
      const fechado = Number(ev?.dias_periodo) > 0;
      const linhas = [
        { rotulo: "Produto", valor: ev?.produto || VAZIO },
        { rotulo: "Quantidade (kg)", valor: fmtNumero(qtdKg, 2) },
        { rotulo: "Sacos", valor: pesoPorSaco > 0 ? fmtNumero(sacos, 2) : VAZIO },
        { rotulo: "Tipo", valor: fechado ? `Período fechado (${ev.dias_periodo} dia(s))` : "Abastecimento" },
      ];
      if (Number(ev?.sobra_kg) > 0) {
        linhas.push({ rotulo: "Sobra (kg)", valor: fmtNumero(ev.sobra_kg, 2) });
      }
      const obs = typeof ev?.observacoes === "string" ? ev.observacoes.trim() : "";
      if (obs) linhas.push({ rotulo: "Observações", valor: obs });
      const cartao = {
        chave: `ev-${ev?.id ?? Math.random()}`,
        dia,
        Icone: IconeLancarSuplementacao,
        titulo: fechado ? "Fechamento de período" : "Suplementação",
        linhas,
        ...(ev?.id && ev.id === ultimoId ? { acoes: <CancelarLancamentoCocho evento={ev} /> } : {}),
      };
      let grupo = dias[dias.length - 1];
      if (!grupo || grupo.dia !== dia) {
        grupo = { chave: `${dia ?? "sem-data"}-${dias.length}`, dia, rotulo: rotuloDoDia(dia), cartoes: [] };
        dias.push(grupo);
      }
      grupo.cartoes.push(cartao);
    });
    return dias;
  }, [eventosDoPonto, produtos, podeCancelarCocho]);

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
  const abas = useMemo(
    () => [
      { id: "detalhes", rotulo: "Detalhes" },
      ...(podeHistorico ? [{ id: "fechamentos", rotulo: "Fechamentos" }] : []),
      { id: "informacoes", rotulo: "Informações" },
      ...(podeHistorico ? [{ id: "historico", rotulo: "Histórico" }] : []),
    ],
    [podeHistorico],
  );
  const aba = abas.some((a) => a.id === abaAtiva) ? abaAtiva : "detalhes";
  const idsAba = idsDaAba(idBaseAbas, aba);

  /** @param {string} nova */
  const irAba = (nova) => {
    if (nova === aba) return;
    const ordem = ["detalhes", "fechamentos", "informacoes", "historico"];
    setAnimAba(ordem.indexOf(nova) > ordem.indexOf(aba) ? "aba-dir" : "aba-esq");
    setAbaAtiva(/** @type {"detalhes" | "fechamentos" | "informacoes" | "historico"} */ (nova));
  };

  // Aberto por cima do depósito, a tela entra empurrando (como as telas empilhadas do lote).
  const casca = {
    titulo: String(ponto?.nome_ponto ?? ""),
    sub: subtitulo || areaNomesRelacionadas.join(", "),
    onVoltar,
    chaveTela: `cocho:${aba}`,
    anim: animAba || (onVoltar ? /** @type {const} */ ("empurrar") : null),
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
    pilulas.push({ chave: "lancar", rotulo: "Lançar", icone: IconeLancarSuplementacao, onClick: () => setShowLancamento(true) });
    pilulas.push({ chave: "leitura", rotulo: "Leitura", icone: ClipboardCheck, onClick: () => setShowLeitura(true) });
  }

  return (
    <>
      <CascaDetalhe
        {...casca}
        className="mk-dp-cocho mk-dp--suplementacao-organizada"
        cabecalhoDoCorpo={
          <Abas
            abas={abas}
            ativa={aba}
            onMudar={irAba}
            idBase={idBaseAbas}
            rotulo="Seções do cocho"
          />
        }
        propsDoCorpo={{ role: "tabpanel", id: idsAba.painel, "aria-labelledby": idsAba.aba }}
        rodape={pilulas.length ? <RodapePilulas itens={pilulas} rotulo="Ações do cocho" /> : null}
      >
        {aba === "detalhes" ? (
          <>
            <section aria-labelledby={idNivel} className="mk-dp-cocho__regiao">
              <h3 id={idNivel} className="mk-dp-cocho__oculto">Nível do cocho</h3>
              <BlocoNivel nivel={nivel} saldoSacos={saldoSacos} consumoSacosDia={consumoSacosDia} />
              <CartaoDoNivel nivel={nivel} duracaoCicloDias={duracaoCicloDias} proximaReposicao={proximaReposicao} />
            </section>

            <section aria-labelledby={idLeitura} className="mk-dp-cocho__regiao mk-dp-secao mk-dp-cocho__leitura">
              <TituloBloco id={idLeitura}>Leitura do cocho</TituloBloco>
              <PainelLeitura farol={farol} ultimas={[]} podeExcluir={false} onExcluir={excluirLeitura} />
            </section>
          </>
        ) : aba === "fechamentos" ? (
          fechamentos.length ? (
            <ul className="mk-dp-cocho__fechamentos" aria-label="Fechamentos do cocho">
              {fechamentos.map((evento) => (
                <li key={evento.id}>
                  <CartaoPeriodoFechado evento={evento} resumo={resumoDoFechamento(evento)} />
                </li>
              ))}
            </ul>
          ) : (
            <Vazio icone={CalendarCheck}>Nenhum período fechado ainda.</Vazio>
          )
        ) : aba === "informacoes" ? (
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
                <Celula rotulo="Limite operacional" valor={nivel.limiteOperacionalKg != null ? formatarKgNivel(nivel.limiteOperacionalKg) : "-"} />
                {nivel.ocupacaoAtualPercentual != null && nivel.saldoKg != null && nivel.limiteOperacionalKg != null ? (
                  <Celula
                    rotulo="Uso do limite"
                    valor={`${formatarPercentualNivel(nivel.ocupacaoAtualPercentual)}${nivel.excessoAtualKg ? ` (${formatarKgNivel(nivel.excessoAtualKg)} acima)` : ""}`}
                  />
                ) : null}
                {nivel.ocupacaoNoLancamentoPercentual != null ? (
                  <Celula
                    rotulo="No lançamento"
                    valor={`${formatarPercentualNivel(nivel.ocupacaoNoLancamentoPercentual)}${nivel.excessoNoLancamentoKg ? ` (${formatarKgNivel(nivel.excessoNoLancamentoKg)} acima)` : ""}`}
                  />
                ) : null}
                <Celula rotulo="Consumo ideal/cab" valor={ponto.consumo_ideal_por_cabeca_kg ? `${formatDecimal(ponto.consumo_ideal_por_cabeca_kg, 3)} kg` : "-"} />
                <Celula rotulo="Consumo mín./cab/dia" valor={ponto.limite_minimo_consumo ? `${formatDecimal(ponto.limite_minimo_consumo, 3)} kg` : "-"} />
                <Celula rotulo="Consumo máx./cab/dia" valor={ponto.limite_maximo_consumo ? `${formatDecimal(ponto.limite_maximo_consumo, 3)} kg` : "-"} />
                <Celula rotulo="Dias alerta reposição" valor={ponto.dias_alerta_reposicao ? `${formatDecimal(ponto.dias_alerta_reposicao, 0, true)} dia(s)` : "-"} />
                <Celula rotulo="Alerta sem lançamento" valor={ponto.alerta_sem_lancamento_dias ? `${formatDecimal(ponto.alerta_sem_lancamento_dias, 0, true)} dia(s)` : "-"} />
              </Grade>
              <Linha rotulo="Observações" valor={ponto.observacoes || "-"} quebra />
            </Cartao>
          </SecaoDetalhe>
        ) : (
          <div className="mk-dp-hist">
            <FiltroHistorico opcoes={FILTROS_COCHO} valor={filtroHistorico} onMudar={setFiltroHistorico} />
            {filtroHistorico !== "leituras" ? (
              <>
                <SecaoDetalhe titulo="Total fornecido por produto" className="mk-dp-cocho__produtos">
                  <Cartao>
                    {resumoProdutos.length === 0 ? (
                      <Linha className="mk-dp-cocho__linha--fraca" rotulo="Nenhum produto lançado ainda." />
                    ) : (
                      resumoProdutos.map((item) => (
                        <Linha
                          key={item.produto ?? ""}
                          rotulo={item.produto || "-"}
                          valor={`${item.sacos.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos · ${formatarKgNivel(item.kg)}`}
                        />
                      ))
                    )}
                  </Cartao>
                </SecaoDetalhe>
                {diasEventosCocho.length > 0 ? (
                  <LinhaDoTempo dias={diasEventosCocho} rotulo="Lançamentos do cocho" />
                ) : (
                  <Vazio icone={History}>Nenhum lançamento registrado neste cocho.</Vazio>
                )}
              </>
            ) : null}
            {filtroHistorico !== "lancamentos" ? (
              <SecaoDetalhe titulo="Leituras do cocho">
                <PainelLeitura farol={farol} ultimas={ultimasLeituras} podeExcluir={podeLancar} onExcluir={excluirLeitura} mostrarResumo={false} />
              </SecaoDetalhe>
            ) : null}
          </div>
        )}
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
    </>);

}

/**
 * Bloco do nível do ciclo: subícone ampliado do cocho à esquerda com o
 * percentual centralizado em cinza claro (`#9ca3af`) e, ao lado, os números
 * principais do ciclo (Saldo estimado e dias restantes) ou o estado neutro.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho, saldoSacos?: number | null, consumoSacosDia?: number | null }} props
 */
function BlocoNivel({ nivel, saldoSacos = null, consumoSacosDia = null }) {
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
  const linhasNeutras = [
    mensagem,
    orientacao,
    baseSemEstimativa ?
    nivel.sobraAnteriorKg ?
    `No início do ciclo: ${formatarKgNivel(/** @type {number} */ (nivel.baseCicloKg))} (${formatarKgNivel(nivel.fornecidoKg ?? 0)} fornecidos + ${formatarKgNivel(nivel.sobraAnteriorKg)} de sobra anterior)` :
    `No início do ciclo: ${formatarKgNivel(/** @type {number} */ (nivel.baseCicloKg))} fornecidos` :
    null,
  ];

  return (
    <div className={nivel.neutro ? "mk-dp-nivel mk-dp-cocho__nivel mk-dp-cocho__painel-nivel mk-dp-cocho__nivel--neutro" : "mk-dp-nivel mk-dp-cocho__nivel mk-dp-cocho__painel-nivel"}>
      <span className="mk-dp-nivel__fig mk-dp-cocho__fig mk-dp-cocho__fig--painel">
        <CochoNivel percent={nivel.fracaoParaSvg} neutro={nivel.neutro} rotuloNeutro={nivel.rotuloCurto} label={ROTULO_RESTANTE_CICLO} />
        <strong aria-hidden="true" className={nivel.neutro ? "mk-dp-cocho__pct mk-dp-cocho__pct--neutro" : "mk-dp-cocho__pct"}>
          {nivel.rotuloCurto}
        </strong>
      </span>
      <div className="mk-dp-nivel__txt mk-dp-cocho__resumo">
        {estimado ? (
          <div className="mk-dp-cocho__metricas">
            <div className="mk-dp-cocho__metrica">
              <span className="mk-dp-cocho__metrica-rot">Saldo estimado do cocho</span>
              <strong className="mk-dp-cocho__metrica-val">{formatarKgNivel(/** @type {number} */ (nivel.saldoKg))}</strong>
              {saldoSacos != null ? (
                <small className="mk-dp-cocho__metrica-sub">{`${formatDecimal(saldoSacos)} sacos`}</small>
              ) : null}
            </div>
            <div className="mk-dp-cocho__metrica">
              <span className="mk-dp-cocho__metrica-rot">Consumo estimado/dia</span>
              <strong className="mk-dp-cocho__metrica-val">{formatarTaxaNivel(/** @type {number} */ (nivel.taxaConsumoKgDia))}</strong>
              {consumoSacosDia != null ? (
                <small className="mk-dp-cocho__metrica-sub">{`${formatDecimal(consumoSacosDia)} sacos/dia`}</small>
              ) : null}
            </div>
          </div>
        ) : (
          linhasNeutras.filter(Boolean).map((linha, i) => (
            <small key={i} className="mk-dp-nivel__linha">{linha}</small>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Cartão de estimativas de consumo abaixo do nível (consumo estimado/dia,
 * duração estimada, próxima reposição ou sobra informada no fechamento).
 * Quando não há nenhum desses dados (ex.: sem lançamento), não renderiza.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho, duracaoCicloDias: number|null, proximaReposicao: string|null }} props
 */
function CartaoDoNivel({ nivel, duracaoCicloDias, proximaReposicao }) {
  const temSobra = nivel.saldoKg != null && nivel.saldoTipo === "informado";
  if (!temSobra && duracaoCicloDias == null && !proximaReposicao) return null;

  return (
    <div className="mk-dp-secao mk-dp-cocho__cartao-nivel">
      <TituloBloco>Estimativas de consumo</TituloBloco>
      <Cartao>
        <Grade>
          {temSobra ? (
            <Celula
              rotulo="Sobra informada"
              valor={formatarKgNivel(/** @type {number} */ (nivel.saldoKg))}
            />
          ) : null}
          {duracaoCicloDias != null ? <Celula rotulo="Duração estimada" valor={`${formatarDias(duracaoCicloDias)} dia(s)`} /> : null}
          {proximaReposicao ? <Celula rotulo="Próxima reposição" valor={proximaReposicao} /> : null}
        </Grade>
      </Cartao>
    </div>
  );
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

/** Formata consumo por cabeça/dia em g (< 1 kg) ou kg (≥ 1 kg). @param {number | null} gramas */
const formatarConsumoCabDia = (gramas) => {
  if (typeof gramas !== "number" || !Number.isFinite(gramas)) return null;
  if (gramas >= 1000) return `${numero(gramas / 1000, 2)} kg`;
  return `${numero(gramas, 0)} g`;
};

/**
 * D-PROD-206 — cartão de período FECHADO do cocho: produto, lançamento e dias,
 * consumo real e consumo esperado separados (em g ou kg/cab/dia), desvio com
 * o farol junto, peso médio, custo por cab/dia antes do custo do período,
 * sobra antiga e aviso de sobra não informada.
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

  const gReal = typeof resumo.consumo_g_cab_dia === "number" && Number.isFinite(resumo.consumo_g_cab_dia)
    ? resumo.consumo_g_cab_dia
    : null;
  const cab = Number(evento.total_cabecas_afetadas || 0);
  const gMeta = typeof resumo.consumo_esperado_g_cab_dia === "number" && Number.isFinite(resumo.consumo_esperado_g_cab_dia)
    ? resumo.consumo_esperado_g_cab_dia
    : typeof resumo.consumo_esperado_fechamento_kg_dia === "number" && cab > 0
      ? (resumo.consumo_esperado_fechamento_kg_dia / cab) * 1000
      : Number(evento.consumo_esperado_pv_kg) > 0 && cab > 0
        ? (Number(evento.consumo_esperado_pv_kg) / cab) * 1000
        : gReal !== null && typeof resumo.consumo_relacao_esperado === "number" && resumo.consumo_relacao_esperado > 0
          ? gReal / resumo.consumo_relacao_esperado
          : null;

  const relacaoPct = typeof resumo.consumo_relacao_esperado === "number" ? resumo.consumo_relacao_esperado * 100 : null;
  const desvioPct = relacaoPct !== null ? Math.round(relacaoPct - 100) : null;
  const desvioTexto = desvioPct !== null ? `${desvioPct > 0 ? `+${desvioPct}` : desvioPct}%` : null;
  const valorFarol = (
    <span data-testid="farol-consumo" data-farol={resumo.farol_consumo}>
      {semReferencia ? farol.rotulo : `${farol.rotulo}${desvioTexto ? ` (${desvioTexto})` : ""}`}
    </span>
  );
  const subFarol = semReferencia ? motivo : faixa ? `Faixa ±${faixa}%` : null;

  const motivoPeso = resumo.peso_medio_periodo_motivo ? MOTIVO_PESO[resumo.peso_medio_periodo_motivo] : null;
  const sobraHerdada = typeof resumo.sobra_herdada_kg === "number" && resumo.sobra_herdada_kg > 0 && typeof resumo.custo_sobra_herdada_kg === "number";

  return (
    <Cartao data-testid="ultimo-periodo-fechado">
      <Grade>
        <Celula rotulo="Produto" valor={evento.produto || "-"} />
        <Celula rotulo="Lançamento" valor={`${diaBR(evento.data_lancamento)} · ${evento.dias_periodo} dia(s)`} />
        <Celula rotulo="Consumo real" valor={formatarConsumoCabDia(gReal) ?? "-"} />
        <Celula rotulo="Consumo esperado" valor={formatarConsumoCabDia(gMeta) ?? "-"} />
        <Celula rotulo="Desvio" valor={valorFarol} bolinha={corFarol} sub={subFarol} />
        {typeof resumo.peso_medio_periodo_kg === "number" ?
        <Celula
          rotulo="Peso médio do período"
          valor={`${numero(resumo.peso_medio_periodo_kg, 0)} kg`}
          sub={resumo.peso_medio_periodo_aproximado ? <span className="mk-dp-cocho__atencao">{`aproximado${motivoPeso ? `: ${motivoPeso}` : ""}`}</span> : null}
          data-testid="peso-medio-periodo" /> :
        null}
        <Celula rotulo="Custo por cab/dia (R$)" valor={numero(resumo.custo_cab_dia, 2) ?? "Sem custo"} />
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
