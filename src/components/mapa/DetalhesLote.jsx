import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

import {
  listarProdutosDaEmpresa,
  criarEventoSuplementacao,
  registrarSuplementacaoEmLote,
} from "@/services/loteManejoService";
import { areaPorId } from "@/domain/lotes/movimentacaoLote";
import { listarIconesPorTipoEntidade } from "@/services/mapaService";
import { getCurrentUser } from "@/services/sessionService";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { aplicarFechamentoSeAindaAberto } from "@/services/suplementacaoService";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from
"@/components/ui/dialog";
import AcoesDoLote from "./AcoesDoLote";
import FormularioMovimentacaoLote from "../lotes/FormularioMovimentacaoLote";
import FormularioMorte from "../lotes/FormularioMorte";
import FormularioNascimento from "../lotes/FormularioNascimento";
import FormularioAbate from "../lotes/FormularioAbate";
import FormularioMudancaCategoria from "../lotes/FormularioMudancaCategoria";
import FormularioPesagem from "../lotes/FormularioPesagem";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";
import { Input } from "@/components/ui/input";
import HistoricoSuplementacaoLote from "../suplementacao/HistoricoSuplementacaoLote";
import RenomearLoteForm from "../lotes/RenomearLoteForm";
import EditarInformacaoPosicaoForm from "../lotes/EditarInformacaoPosicaoForm";
import { LancLoteDialogo, LancLoteForm, LancLoteAviso, LancLoteRodape, LL_CTL } from "../lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";
import ResumoSuplementacao from "../suplementacao/ResumoSuplementacao";
import InformacoesArea from "./InformacoesArea";
import { Progress } from "@/components/ui/progress";
import { IconeEditarInformacao, IconeHistoricoMovimentacao, IconeHistoricoSuplementacao, IconeJuntarLotes, IconeMorte, IconeMoverAnimais, IconeMudarCategoria, IconeNascimento, IconePesar, IconeSaida } from "@/components/mapa/IconesManejo";
import { corpoNascimento, corpoPesagem, corpoMudancaCategoria, corpoJuncao, corpoBaixa, previaJuncao, corpoTransferenciaLedger, ehPosicaoDoLedger } from "@/domain/lotes/manejoRebanho";
import { enviarManejoRebanho, enviarJuncaoLotes, enviarBaixaRebanho, enviarTransferenciaLedger, mensagemDaTransferenciaLedger, mensagemDoErro, codigoDoErro, MENSAGENS_MANEJO_REBANHO } from "@/services/manejoRebanhoService";
import { escopoDoUsuario } from "../lotes/ExcluirMovimentacao";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import CampoDl from "./CampoDl";

/**
 * Contrato do dono (D-PROD-107): `Lote` é só o cadastro de ENTRADA. O navegador
 * nunca grava efeito de manejo em Lote — nada de PATCH de saldo/área/status,
 * lote derivado ou fallback com várias requisições. Todo manejo do mapa vai pelos
 * comandos do servidor, que só rodam no ledger (empresa ativada: o mapa entrega
 * POSIÇÕES). Empresa ainda não migrada: o manejo é recusado aqui, sem requisição
 * (o servidor responderia 409 REBANHO_CUTOVER_PENDENTE).
 */
const recusarManejoSemLedger = () => {
  toast.error(MENSAGENS_MANEJO_REBANHO.REBANHO_CUTOVER_PENDENTE);
};

/** Botões abaixo do título: cada um abre a sua parte do Detalhes do Lote. */
const ABAS_DO_LOTE = [
  { id: 'area', nome: 'Informações da Área' },
  { id: 'lote', nome: 'Informações do Lote' },
  { id: 'manejos', nome: 'Manejos' },
  { id: 'historicos', nome: 'Históricos' },
];

export default function DetalhesLote({ lotes, onClose, permissions = {} }) {
  /** R2E-P1 (D-PROD-107): o mapa entregou POSIÇÕES do ledger (empresa ativada), não Lotes. */
  const modoLedger = (lotes || []).some(ehPosicaoDoLedger);
  const transferenciaEmAndamento = useRef(false);
  /** PR174-R1: aviso quando a transferência gravou e um passo seguinte (fechamento do consumo, sobras) falhou. */
  const avisoSobrasLedger = useRef(/** @type {string|null} */ (null));
  // PR174-R1 (D-PROD-107): no ledger TODOS os manejos (Morte, Abate, Nascimento,
  // Pesagem, Mudança de Categoria, Junção, Transferência) vão pelos mesmos
  // comandos atômicos do servidor, que operam sobre as POSIÇÕES desta área.
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const [showMovimentacao, setShowMovimentacao] = useState(false);
  const [showMorte, setShowMorte] = useState(false);
  const [showNascimento, setShowNascimento] = useState(false);
  const [showAbate, setShowAbate] = useState(false);
  const [showMudancaCategoria, setShowMudancaCategoria] = useState(false);
  const [showPesagem, setShowPesagem] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [showHistoricoSupl, setShowHistoricoSupl] = useState(false);
  /** Aba aberta no Detalhes do Lote (botões abaixo do título). */
  const [abaDetalhes, setAbaDetalhes] = useState('area');
  const [showRenomear, setShowRenomear] = useState(false);
  const [novoNomeLote, setNovoNomeLote] = useState('');
  const [loteParaRenomear, setLoteParaRenomear] = useState(null);
  /** Chave da transferência do ledger: nasce na 1ª confirmação e morre quando o diálogo Mover fecha. */
  const chaveTransferenciaLedger = useRef(null);
  useEffect(() => {
    if (!showMovimentacao) chaveTransferenciaLedger.current = null;
  }, [showMovimentacao]);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });
  const [showJuntarLotes, setShowJuntarLotes] = useState(false);
  const [lotePrincipalJuncao, setLotePrincipalJuncao] = useState(null);
  const [categoriaSelecionadaJuncao, setCategoriaSelecionadaJuncao] = useState(null);
  const [dataJuncao, setDataJuncao] = useState(() => new Date().toISOString().split('T')[0]);
  const [areaDestinoPreSelecionada, setAreaDestinoPreSelecionada] = useState(null);
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ['detalhes-lote-user'], queryFn: () => getCurrentUser(), staleTime: 10 * 60 * 1000 });

  /** Abre o formulário de um manejo; sem ledger (empresa não migrada) recusa sem requisição. */
  const abrirManejo = (abrir) => {
    if (!modoLedger) {
      recusarManejoSemLedger();
      return;
    }
    abrir(true);
  };

  // Listener para abrir movimentação via drag-and-drop
  React.useEffect(() => {
    const handleOpenMovimentacao = (e) => {
      if (!modoLedger) {
        recusarManejoSemLedger();
        return;
      }
      setAreaDestinoPreSelecionada(e?.detail?.areaDestinoId || null);
      setShowMovimentacao(true);
    };

    window.addEventListener('open-movimentacao', handleOpenMovimentacao);
    return () => {
      window.removeEventListener('open-movimentacao', handleOpenMovimentacao);
    };
  }, [modoLedger]);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones-global'],
    queryFn: async () => {
      const all = await listarIconesPorTipoEntidade(null);
      return all.filter((i) => i.ativo !== false);
    },
    staleTime: 10 * 60 * 1000
  });

  // Agrupar lotes por categoria
  const lotesPorCategoria = lotes.reduce((acc, lote) => {
    const cat = lote.categoria?.toUpperCase() || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = [];
    }
    acc[cat].push(lote);
    return acc;
  }, {});

  const categorias = Object.keys(lotesPorCategoria).sort();

  // Calcular total de cabeças
  const totalCabecas = lotes.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);

  // Título com nomes dos lotes

  const { data: areas = [], isLoading: loadingAreas } = useQuery({
    queryKey: ['mapa-areas', empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('areas', empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('areas', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(['mapa-areas', empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('areas', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const areaAtual = areas.find((a) => a.id === lotes[0]?.area_atual_id) || { nome: lotes[0]?.area_atual_nome || 'Desconhecida' };

  // Buscar todos os lotes ativos na mesma área (para métricas da área)
  const { data: todosLotesNaArea = [], isLoading: loadingLotesArea } = useQuery({
    queryKey: ['mapa-lotes', empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('lotes', empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('lotes', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(['mapa-lotes', empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('lotes', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 60 * 1000,
    select: (data) => data.filter(l => l.area_atual_id === lotes[0]?.area_atual_id)
  });

  // Aguarda a leitura do cache local (IndexedDB) que é super rápida, para não exibir os dados zerados
  const loadingInicial = (loadingAreas && areas.length === 0) || (loadingLotesArea && todosLotesNaArea.length === 0);

  const movimentacaoMutation = useMutation({
    mutationFn: async (formData) => {
      console.log('🔄 INICIANDO MOVIMENTAÇÃO');
      if (!modoLedger) {
        throw Object.assign(new Error('cutover-pendente'), { mensagemTela: MENSAGENS_MANEJO_REBANHO.REBANHO_CUTOVER_PENDENTE });
      }
      // O cache de áreas pode não ter a área criada há pouco (caso real: destino
      // gravado com id certo e nome vazio). Faltando alguma, relê as áreas.
      let areasConhecidas = areas;
      const idsDasAreas = /** @type {{ area_saida_id?: string, area_entrada_id?: string }} */ (/** @type {unknown} */ (formData));
      const faltaArea = [idsDasAreas.area_saida_id, idsDasAreas.area_entrada_id].some(
        (id) => id && !areaPorId(areasConhecidas, id)
      );
      if (faltaArea && navigator.onLine) {
        const frescas = await refreshMapaCacheEntry('areas', empresaSelecionadaId, { force: true });
        if (frescas?.length) {
          areasConhecidas = frescas;
          queryClient.setQueryData(['mapa-areas', empresaSelecionadaId], frescas);
        }
      }
      const areaEntrada = areaPorId(areasConhecidas, formData.area_entrada_id);

      /**
       * Sobras do cocho do destino: abre o novo lançamento de suplementação com
       * a sobra anterior e o vincula às cabeças que ficaram na área de destino.
       * No ledger (PR174-R1) isto é um PASSO SEPARADO, depois do comando da
       * transferência: as linhas citam posições e o servidor grava posicao_id +
       * lote_id da entrada (resolverPosicoesNosDocumentos).
       */
      const registrarSobrasNoDestino = async (lotesAtualizadosDestino) => {
        const totalMovimentado = formData.mover_todos === 'sim'
          ? lotes.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0), 0)
          : (formData.movimentacoes || []).reduce((sum, mov) => sum + Number(mov.quantidade || 0), 0);

        const produtosEmpresa = await listarProdutosDaEmpresa(empresaSelecionadaId);
        const lotesParaHistoricoSuplementacao = lotesAtualizadosDestino.filter((lote) =>
          lote.area_atual_id === formData.area_entrada_id &&
          lote.status === 'Ativo' &&
          Number(lote.quantidade_cabecas || 0) > 0
        );
        const totalCabecasHistorico = lotesParaHistoricoSuplementacao.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0), 0);
        const pesoMedioHistorico = totalCabecasHistorico > 0
          ? lotesParaHistoricoSuplementacao.reduce((sum, lote) => sum + Number(lote.peso_medio_kg || 0) * Number(lote.quantidade_cabecas || 0), 0) / totalCabecasHistorico
          : 0;

        for (const sobra of formData.sobras_destino_aproveitar) {
          const produtoSobra = produtosEmpresa.find((produto) => produto.id === sobra.produto_id || produto.nome_produto === sobra.produto) || null;
          const percentualPV = Number(produtoSobra?.percentual_consumo_pv || 0);
          const consumoEsperadoGrupo = percentualPV > 0 && pesoMedioHistorico > 0
            ? (pesoMedioHistorico * (percentualPV / 100)) * totalCabecasHistorico
            : null;
          const novoEventoSuplementacao = await criarEventoSuplementacao({
            empresa_id: empresaSelecionadaId,
            ponto_suplementacao_id: sobra.ponto_id,
            ponto_nome: sobra.ponto_nome,
            area_id: formData.area_entrada_id,
            area_nome: areaEntrada?.nome || '',
            area_ids: [formData.area_entrada_id],
            area_nomes: [areaEntrada?.nome || ''].filter(Boolean),
            data_lancamento: formData.data_movimentacao,
            produto: sobra.produto,
            produto_id: sobra.produto_id || null,
            tipo_consumo: sobra.tipo_consumo || null,
            quantidade_total_kg: 0,
            sobra_kg: Number(sobra.sobra_kg || 0),
            dias_periodo: null,
            consumo_diario_grupo_kg: null,
            total_cabecas_afetadas: totalCabecasHistorico || totalMovimentado,
            peso_medio_lotes_kg: pesoMedioHistorico || null,
            consumo_esperado_pv_kg: consumoEsperadoGrupo,
            percentual_consumo_pv_usado: percentualPV > 0 ? percentualPV : null,
            observacoes: `Novo lançamento de consumo aberto automaticamente após movimentação, aproveitando sobra anterior de ${Number(sobra.sobra_kg || 0).toFixed(2)} kg.`,
          });

          if (lotesParaHistoricoSuplementacao.length > 0) {
            await registrarSuplementacaoEmLote(lotesParaHistoricoSuplementacao.map((lote) => ({
              empresa_id: empresaSelecionadaId,
              suplementacao_evento_id: novoEventoSuplementacao.id,
              lote_id: lote.id,
              lote_nome: lote.nome,
              categoria: lote.categoria,
              fator_consumo: 1,
              peso_medio_lote_kg: Number(lote.peso_medio_kg || 0) || null,
              consumo_esperado_pv_lote_kg: percentualPV > 0 && Number(lote.peso_medio_kg || 0) > 0
                ? Number(lote.peso_medio_kg || 0) * (percentualPV / 100) * Number(lote.quantidade_cabecas || 0)
                : null,
              data_lancamento: formData.data_movimentacao,
              produto: sobra.produto,
              cabecas_na_area: Number(lote.quantidade_cabecas || 0),
              peso_consumo_lote: Number(lote.quantidade_cabecas || 0),
              percentual_consumo_lote: totalMovimentado > 0 ? Number(lote.quantidade_cabecas || 0) / totalMovimentado : 0,
              dias_periodo: null,
              consumo_unitario_dia: null,
              consumo_por_cabeca_dia_kg: null,
              consumo_total_lote_periodo_kg: null,
            })));
          }
        }
      
      };

      // R2E-P1 (D-PROD-107): empresa no ledger → UM comando do servidor por
      // confirmação (posições + quantidades). Sem validação temporal no
      // navegador (o servidor confere a linha do tempo inteira), sem PATCH/POST
      // e sem lote derivado. Sem ledger não há caminho de escrita no navegador
      // (recusado no topo desta função, antes de qualquer requisição).
      if (modoLedger) {
        const dadosLedger = /** @type {any} */ (formData);
        avisoSobrasLedger.current = null;
        const { corpo, faltando } = corpoTransferenciaLedger({ empresaId: empresaSelecionadaId, areaDestinoId: dadosLedger.area_entrada_id, data: dadosLedger.data_movimentacao, posicoes: lotes, formData: dadosLedger });
        if (faltando.length || !corpo.itens.length) {
          throw Object.assign(new Error('ledger'), { mensagemTela: `Quantidade maior que as posições desta área (${faltando.map((f) => `${f.categoria}: faltam ${f.faltam}`).join(', ') || 'nada a mover'}). Nada foi gravado.` });
        }
        // Uma chave idempotente por abertura do diálogo: reenvio do MESMO conteúdo
        // (duplo toque, mesmo depois de o servidor responder) vira replay, nunca 2ª transferência.
        if (!chaveTransferenciaLedger.current) {
          chaveTransferenciaLedger.current = `ledger-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        }
        let resposta;
        try {
          resposta = /** @type {any} */ (await enviarTransferenciaLedger({ operation_id: chaveTransferenciaLedger.current, ...corpo }, { escopo: escopoDoUsuario(user) }));
        } catch (erro) {
          throw Object.assign(new Error('ledger'), { mensagemTela: mensagemDaTransferenciaLedger(erro) });
        }
        const avisosFechamento = [];
        // D-PROD-137 (SUP-01): o fechamento do consumo da ORIGEM, calculado no
        // passo do consumo, só é gravado agora — com a transferência confirmada
        // (recusa, cancelamento e offline não deixam período fechado sem o gado
        // ter saído). Também no replay: nesta abertura do diálogo ele só roda
        // depois de uma resposta de sucesso, então um replay significa que a
        // resposta anterior se perdeu antes dele. E só grava se o período
        // continua aberto (não sobrescreve quem fechou no meio tempo).
        const fechamentos = Array.isArray(dadosLedger.fechamentos_consumo) ? dadosLedger.fechamentos_consumo : [];
        const naoFechados = [];
        const jaFechados = [];
        for (const fechamento of fechamentos) {
          const cocho = fechamento?.ponto_nome || 'cocho';
          try {
            const r = await aplicarFechamentoSeAindaAberto(fechamento);
            if (r.motivo === 'ja_fechado') jaFechados.push(cocho);
            else if (!r.aplicado) naoFechados.push(`${cocho} (período não encontrado)`);
          } catch (erroFechamento) {
            naoFechados.push(`${cocho} (${/** @type {any} */ (erroFechamento)?.message || 'erro'})`);
          }
        }
        if (naoFechados.length) {
          avisosFechamento.push(`Transferência registrada, mas o consumo de ${naoFechados.join(', ')} NÃO foi fechado. Feche-o no cocho (Lançar).`);
        }
        if (jaFechados.length) {
          avisosFechamento.push(`O consumo de ${jaFechados.join(', ')} já tinha sido fechado por outro lançamento e não foi alterado.`);
        }
        // A transferência JÁ está gravada. As sobras são um segundo passo
        // explícito: se falharem, o usuário vê exatamente isso (sem falso
        // sucesso e sem dizer "nada foi gravado" sobre a transferência).
        if (Array.isArray(dadosLedger.sobras_destino_aproveitar) && dadosLedger.sobras_destino_aproveitar.length > 0 && !resposta?.replay) {
          try {
            const posicoesAtuais = /** @type {any[]} */ ((await refreshMapaCacheEntry('lotes', empresaSelecionadaId, { force: true })) || []);
            await registrarSobrasNoDestino(posicoesAtuais);
          } catch (erroSobras) {
            avisoSobrasLedger.current = `Transferência registrada, mas as sobras do cocho NÃO foram registradas (${/** @type {any} */ (erroSobras)?.message || 'erro'}). Registre a suplementação no cocho do destino.`;
          }
        }
        if (avisosFechamento.length) {
          avisoSobrasLedger.current = [...avisosFechamento, avisoSobrasLedger.current].filter(Boolean).join(' ');
        }
        return resposta?.movimentacao ? [resposta.movimentacao] : [];
      }
    },
    onSuccess: async () => {
      if (avisoSobrasLedger.current) {
        toast.warning(avisoSobrasLedger.current);
        avisoSobrasLedger.current = null;
      } else {
        toast.success('Gado movido com sucesso!');
      }
      setAreaDestinoPreSelecionada(null);
      setShowMovimentacao(false);
      window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['lotes', 'movimentacoes', 'movimentacoesHistorico'] } }));
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-cache', 'lotes'] });

      onClose();
    },
    onError: (error) => {
      console.error('❌ Erro:', error);
      const codigo = codigoDoErro(error);
      toast.error(/** @type {any} */ (error)?.mensagemTela || (codigo && MENSAGENS_MANEJO_REBANHO[codigo]) || '❌ Erro ao mover gado');
    }
  });

  const handleMovimentacao = async (formData) => {
    // PR174-R1: no ledger a pesagem é o comando próprio (menu Pesar), sobre as posições.
    // Trava síncrona + espera da mutação: o formulário fica "Movimentando…" até o
    // servidor responder e um segundo toque não vira segundo envio (achado no E2E).
    if (modoLedger) {
      if (transferenciaEmAndamento.current) return;
      // Offline o React Query PAUSA a mutação (networkMode 'online') e o botão
      // ficaria "Movimentando…" para sempre: recusa explícita antes de tudo.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast.error(mensagemDoErro({ code: 'MANEJO_REBANHO_OFFLINE' }));
        return;
      }
      transferenciaEmAndamento.current = true;
      try {
        await movimentacaoMutation.mutateAsync(formData);
      } catch {
        /* onError já mostrou a mensagem; o diálogo continua aberto */
      } finally {
        transferenciaEmAndamento.current = false;
      }
      return;
    }
    recusarManejoSemLedger();
  };

  /**
   * R2D-P1 (D-PROD-105): Morte e Abate — UMA confirmação do formulário (todas as
   * categorias) é UM comando do servidor: ele escolhe os lotes da área pela
   * política determinística, baixa todos numa transação e grava UM movimento
   * cancelável como unidade. Nada de laço de comandos por lote, nem POST+PATCH
   * legado: offline fica indisponível antes de qualquer requisição. Erro
   * definitivo ou desconhecido: o diálogo continua aberto com a explicação.
   */
  const [enviandoBaixa, setEnviandoBaixa] = useState(false);
  const baixaEmAndamento = useRef(false);
  const executarBaixa = async (tipo, formData, data, fechar) => {
    if (!modoLedger) return recusarManejoSemLedger();
    // Trava síncrona: duplo clique antes da nova renderização não gera 2º POST.
    if (baixaEmAndamento.current) return;
    baixaEmAndamento.current = true;
    setEnviandoBaixa(true);
    try {
      const corpo = corpoBaixa({ tipo, empresaId: empresaSelecionadaId, areaId: areaDoManejo(), data, observacoes: formData.observacoes, linhas: formData.linhas, loteIds: lotes.map((l) => l.id) });
      const resposta = /** @type {any} */ (await enviarBaixaRebanho(corpo, { escopo: escopoDoUsuario(user) }));
      const distribuicao = (resposta?.movimentacao?.baixa?.lotes || []).map((l) => `${l.nome}: ${l.quantidade}`).join(', ');
      toast.success(
        resposta?.replay
          ? `${tipo}: o servidor já tinha este registro (nada duplicado)`
          : `${tipo} registrado: ${resposta?.movimentacao?.quantidade_animais ?? ''} cab${distribuicao ? ` (${distribuicao})` : ''}`
      );
      fechar(false);
      onClose();
      window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['lotes', 'movimentacoes', 'movimentacoesHistorico'] } }));
    } catch (erro) {
      toast.error(mensagemDaTransferenciaLedger(erro));
    } finally {
      baixaEmAndamento.current = false;
      setEnviandoBaixa(false);
    }
  };

  const handleMorte = (formData) => executarBaixa('Morte', formData, formData.data_ocorrencia, setShowMorte);

  /**
   * R2B-P1 (D-PROD-101): Nascimento, Pesagem e Mudança de Categoria vão por UM
   * comando atômico do servidor por confirmação — todas as linhas e lotes numa
   * transação, cancelável como unidade. Offline: indisponível (sem fallback de
   * POST+PATCH soltos). Erro: nada gravado, mensagem clara; o formulário fica
   * aberto para corrigir ou reenviar o MESMO registro (mesma chave).
   */
  const executarManejoRebanho = async (corpo, rotulo, fechar) => {
    if (!modoLedger) return recusarManejoSemLedger();
    try {
      const resposta = /** @type {any} */ (await enviarManejoRebanho(corpo, { escopo: escopoDoUsuario(user) }));
      toast.success(resposta?.replay ? `${rotulo}: o servidor já tinha este registro (nada duplicado)` : `${rotulo} registrado`);
      fechar(false);
      onClose();
      window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['lotes', 'movimentacoes', 'movimentacoesHistorico'] } }));
    } catch (erro) {
      toast.error(mensagemDaTransferenciaLedger(erro));
    }
  };

  const areaDoManejo = () => lotes[0]?.area_atual_id;

  /**
   * R2C-P1 (D-PROD-104): Junção de Lotes por UM comando do servidor — soma,
   * zera as origens e grava o movimento 'Junção de Lotes' numa transação.
   * Nada de PATCH em sequência nem POST genérico; offline fica indisponível.
   */
  const [enviandoJuncao, setEnviandoJuncao] = useState(false);
  const confirmarJuncao = async (principal, origens) => {
    if (!modoLedger) return recusarManejoSemLedger();
    if (enviandoJuncao) return;
    setEnviandoJuncao(true);
    try {
      const corpo = corpoJuncao({
        empresaId: empresaSelecionadaId,
        areaId: principal.area_atual_id,
        principalId: principal.id,
        origemIds: origens.map((l) => l.id),
        data: dataJuncao,
      });
      const resposta = /** @type {any} */ (await enviarJuncaoLotes(corpo, { escopo: escopoDoUsuario(user) }));
      const final = (resposta?.lotes || []).find((l) => l.id === principal.id);
      toast.success(
        resposta?.replay
          ? 'Junção: o servidor já tinha este registro (nada duplicado)'
          : `Lotes unificados: ${final?.quantidade_cabecas ?? '?'} cabeças no lote "${principal.nome}"`
      );
      setShowJuntarLotes(false);
      setLotePrincipalJuncao(null);
      onClose();
      window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['lotes', 'movimentacoes', 'movimentacoesHistorico'] } }));
    } catch (erro) {
      toast.error(mensagemDaTransferenciaLedger(erro));
    } finally {
      setEnviandoJuncao(false);
    }
  };

  const handleNascimento = (formData) =>
    executarManejoRebanho(corpoNascimento({ empresaId: empresaSelecionadaId, areaId: areaDoManejo(), formData }), 'Nascimento', setShowNascimento);

  const handleAbate = (formData) => executarBaixa('Abate', formData, formData.data_abate, setShowAbate);

  const handleMudancaCategoria = (formData) =>
    executarManejoRebanho(corpoMudancaCategoria({ empresaId: empresaSelecionadaId, areaId: areaDoManejo(), formData }), 'Mudança de categoria', setShowMudancaCategoria);

  const handlePesagem = async (formData) => {
    if (!modoLedger) return recusarManejoSemLedger();
    const lotesParaPesar = lotes;
    const corpo = corpoPesagem({ empresaId: empresaSelecionadaId, areaId: lotesParaPesar[0]?.area_atual_id, lotes: lotesParaPesar, formData });
    if (!corpo.linhas.length) {
      toast.error('Nenhum lote com peso válido para registrar.');
      return;
    }
    await executarManejoRebanho(corpo, 'Pesagem', setShowPesagem);
  };

  if (loadingInicial) {
    return (
      <div className="space-y-2" translate="no">
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando detalhes do lote...</span>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="mk-dl space-y-2" translate="no">
      <div className="mk-dl__abas" role="tablist" aria-label="Seções do lote">
        {ABAS_DO_LOTE.map(({ id, nome }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={abaDetalhes === id}
            className={`mk-dl__aba${abaDetalhes === id ? ' is-ativa' : ''}`}
            onClick={() => setAbaDetalhes(id)}>
            {nome}
          </button>
        ))}
      </div>

      {abaDetalhes === 'area' && <InformacoesArea area={areaAtual} lotesNaArea={todosLotesNaArea} />}

      {abaDetalhes === 'lote' && <>
      <div className="mk-dl__lotes">
        {categorias.map((categoria) => {
            const lotesCategoria = lotesPorCategoria[categoria];
            const configIcone = iconesConfig.find((ic) =>
            ic.tipo_entidade === 'Lote' &&
            ic.categoria?.toUpperCase() === categoria?.toUpperCase()
            );
            const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

            return lotesCategoria.map((lote) => {
              const cab = lote.quantidade_cabecas || 0;
              const peso = lote.peso_medio_kg || 0;
              const hoje = new Date();hoje.setHours(0, 0, 0, 0);
              const entrada = lote.data_entrada ? new Date(lote.data_entrada) : null;
              let diasPastejo = 0;
              if (entrada) {entrada.setHours(0, 0, 0, 0);diasPastejo = Math.max(0, Math.floor((hoje - entrada) / 86400000));}

              return (
                <div key={lote.id} className="mk-dl__cartao">
                <div className="mk-dl__cab">
                  <span className="mk-dl__nome">Lote: {lote.nome}</span>
                  {iconeUrl &&
                    <span className="mk-dl__icone"><img src={iconeUrl} alt={categoria} /></span>
                    }
                </div>
                <div className="mk-dl__infos">
                  <CampoDl rotulo="Identificador">
                      {lote.identificador_cor && <span className="mk-dl__cor" style={{ backgroundColor: lote.identificador_cor }} />}
                      {(lote.identificador_nome || '-').toUpperCase()}
                    </CampoDl>
                  <CampoDl rotulo="Sigla">{(lote.identificador_sigla || '-').toUpperCase()}</CampoDl>
                  <CampoDl rotulo="Qtd. Cabeças">{cab.toLocaleString('pt-BR')}</CampoDl>
                  <CampoDl rotulo="Peso Médio">{peso > 0 ? `${peso.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` : '-'}</CampoDl>
                  <CampoDl rotulo="Dias de pastejo">{diasPastejo.toLocaleString('pt-BR')} dia(s)</CampoDl>
                  <CampoDl rotulo="Sist. Rep.">{(lote.sistema_produtivo || '-').toUpperCase()}</CampoDl>
                  <CampoDl rotulo="Raça Predominante">{(lote.raca_predominante || '-').toUpperCase()}</CampoDl>
                  <CampoDl rotulo="Sexo">{(lote.sexo || '-').toUpperCase()}</CampoDl>
                </div>
                <div className="mk-dl__chips">
                  <span className="mk-dl__chip">Categoria de Manejo: <strong>{(lote.categoria_manejo_nome || '-').toUpperCase()}</strong></span>
                </div>
              </div>);

            });
          })}
      </div>

      <ResumoSuplementacao lotesIds={lotes.map((l) => l.id)} lotesInformados={modoLedger ? lotes : undefined} modo="completo" areaId={lotes[0]?.area_atual_id || ""} />
      </>}

      {/* D-PROD-119: um botão só abre os quadros de Manejos e Históricos (separados). */}
      {(() => {
        const porCategoria = {};
        lotes.forEach((l) => {
          const cat = (l.categoria || '').toUpperCase();
          if (!porCategoria[cat]) porCategoria[cat] = [];
          porCategoria[cat].push(l);
        });
        const categoriasJuntaveis = Object.entries(porCategoria).filter(([, ls]) => ls.length > 1);
        const abrirJuncao = () => {
          if (!modoLedger) {
            recusarManejoSemLedger();
            return;
          }
          setCategoriaSelecionadaJuncao(categoriasJuntaveis.length === 1 ? categoriasJuntaveis[0][0] : null);
          setLotePrincipalJuncao(null);
          setShowJuntarLotes(true);
        };
        const abrirRenomear = () => {
          // D-PROD-139: no ledger, edita nome e identificação da POSIÇÃO (este
          // grupo nesta área) por comando próprio; o Cadastro de Lotes não é escrito.
          if (lotes.length === 1) {
            setLoteParaRenomear(lotes[0]);
            setNovoNomeLote(lotes[0].nome);
          } else {
            setLoteParaRenomear(null);
          }
          setShowRenomear(true);
        };
        const manejos = [
          permissions.registrar_abate !== false && { nome: 'Saída', Icone: IconeSaida, onClick: () => abrirManejo(setShowAbate) },
          permissions.juntar_lotes !== false && lotes.length > 1 && categoriasJuntaveis.length > 0 && { nome: 'Juntar Lotes', Icone: IconeJuntarLotes, onClick: abrirJuncao },
          permissions.mover_lotes !== false && { nome: 'Mover', Icone: IconeMoverAnimais, onClick: () => abrirManejo(setShowMovimentacao) },
          permissions.mudar_categoria_lotes !== false && { nome: 'Mudar Categoria', Icone: IconeMudarCategoria, onClick: () => abrirManejo(setShowMudancaCategoria) },
          permissions.registrar_nascimento !== false && { nome: 'Nascimento', Icone: IconeNascimento, onClick: () => abrirManejo(setShowNascimento) },
          permissions.registrar_morte !== false && { nome: 'Morte', Icone: IconeMorte, onClick: () => abrirManejo(setShowMorte) },
          permissions.pesar_lotes !== false && { nome: 'Pesar', Icone: IconePesar, onClick: () => abrirManejo(setShowPesagem) },
          permissions.renomear_lotes !== false && { nome: 'Editar Informação', Icone: IconeEditarInformacao, onClick: abrirRenomear },
        ].filter(Boolean);
        const historicos = [
          permissions.visualizar_historico_movimentacoes_lote !== false && { nome: 'Movimentação', rotulo: 'Histórico de Movimentação', Icone: IconeHistoricoMovimentacao, onClick: () => setShowHistorico(true) },
          permissions.visualizar_historico_suplementacao_lote !== false && { nome: 'Suplementação', rotulo: 'Histórico de Suplementação', Icone: IconeHistoricoSuplementacao, onClick: () => setShowHistoricoSupl(true) },
        ].filter(Boolean);
        return (
          <>
            {abaDetalhes === 'manejos' && manejos.length > 0 && (
              <div className="my-1">
                <AcoesDoLote grupos={[{ titulo: 'Manejos', itens: manejos }]} inline />
              </div>
            )}
            {abaDetalhes === 'historicos' && historicos.length > 0 && (
              <div className="my-1">
                <AcoesDoLote grupos={[{ titulo: 'Históricos', itens: historicos }]} inline />
              </div>
            )}
          </>
        );
      })()}

      {/* Dialog Juntar Lotes */}
      <LancLoteDialogo open={showJuntarLotes} onOpenChange={(open) => {if (!open && enviandoJuncao) return;setShowJuntarLotes(open);if (!open) {setCategoriaSelecionadaJuncao(null);setLotePrincipalJuncao(null);}}} titulo="Juntar Lotes" lotes={lotes}>
          {(() => {
              const porCategoria = {};
              lotes.forEach((l) => {
                const cat = (l.categoria || '').toUpperCase();
                if (!porCategoria[cat]) porCategoria[cat] = [];
                porCategoria[cat].push(l);
              });
              const categoriasJuntaveis = Object.entries(porCategoria).filter(([, ls]) => ls.length > 1);

              if (!categoriaSelecionadaJuncao && categoriasJuntaveis.length > 1) {
                return (
                  <div className="mk-ll">
                  <p className="mk-ll__texto">Selecione a categoria para juntar:</p>
                  {categoriasJuntaveis.map(([cat, ls]) =>
                    <button type="button" key={cat} className="mk-ll__opcao" onClick={() => {setCategoriaSelecionadaJuncao(cat);setLotePrincipalJuncao(null);}}>
                      <span>{cat}</span>
                      <span>{ls.length} lotes · {ls.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0)} cab</span>
                    </button>
                    )}
                </div>);

              }

              const catSel = categoriaSelecionadaJuncao || categoriasJuntaveis[0] && categoriasJuntaveis[0][0];
              const lotesParaJuntar = porCategoria[catSel] || [];

              if (!lotePrincipalJuncao && lotesParaJuntar.length > 0) {
                return (
                  <div className="mk-ll">
                  <p className="mk-ll__texto">Selecione o lote que receberá os animais (lote principal):</p>
                  <p className="mk-ll__item-sub">Categoria: <strong>{catSel}</strong></p>
                  {lotesParaJuntar.map((l) =>
                    <button type="button" key={l.id} className="mk-ll__opcao" onClick={() => setLotePrincipalJuncao(l)}>
                      <span>{l.nome}</span>
                      <span>{l.quantidade_cabecas} cab</span>
                    </button>
                    )}
                </div>);

              }

              if (lotePrincipalJuncao && lotesParaJuntar.length > 0) {
                const outrosLotes = lotesParaJuntar.filter((l) => l.id !== lotePrincipalJuncao.id);
                const totalCab = lotesParaJuntar.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
                return (
                  <LancLoteForm onSubmit={(e) => { e.preventDefault(); if (!enviandoJuncao) confirmarJuncao(lotePrincipalJuncao, outrosLotes); }}>
                  <LancLoteAviso tom="verde">
                    <p className="font-semibold">Lote principal: {lotePrincipalJuncao.nome}</p>
                    <p className="text-[11px]">{lotePrincipalJuncao.quantidade_cabecas} cab → {totalCab} cab após junção (prévia; o servidor confere tudo ao confirmar)</p>
                  </LancLoteAviso>
                  {!previaJuncao(lotesParaJuntar).pesoConhecido && (
                    <p role="note" data-testid="aviso-peso-juncao" className="mk-ll__aviso mk-ll__aviso--ambar">
                      Algum lote está sem peso médio: depois da junção o lote principal fica <strong>sem peso</strong> até a próxima pesagem (o desconhecido não é tratado como zero).
                    </p>
                  )}
                  <p className="mk-ll__texto">Lotes que serão absorvidos:</p>
                  {outrosLotes.map((l) =>
                    <div key={l.id} className="mk-ll__opcao" style={{ cursor: 'default' }}>
                      <span>{l.nome}</span>
                      <span>{l.quantidade_cabecas} cab</span>
                    </div>
                    )}
                  <LancField label="Data" required>
                    <Input type="date" value={dataJuncao} onChange={(e) => setDataJuncao(e.target.value)} className={LL_CTL} />
                  </LancField>
                  <button type="button" className="mk-ll__texto self-start underline-offset-2 hover:underline" onClick={() => setLotePrincipalJuncao(null)} disabled={enviandoJuncao}>‹ Voltar e escolher outro lote principal</button>
                  <LancLoteRodape onCancelar={() => setShowJuntarLotes(false)} cancelarDesabilitado={enviandoJuncao} textoAcao="Confirmar Junção" textoEnviando="Juntando..." enviando={enviandoJuncao} />
                </LancLoteForm>);

              }
              return null;
            })()}
      </LancLoteDialogo>

      <LancLoteDialogo open={showMovimentacao} onOpenChange={(open) => {
          setShowMovimentacao(open);
          if (!open) setAreaDestinoPreSelecionada(null);
        }} titulo="Mover Lotes" lotes={lotes} largo>
          <FormularioMovimentacaoLote
              lotesOriginais={lotes}
              areaOrigem={areaAtual}
              areaDestinoPreSelecionada={areaDestinoPreSelecionada}
              podeLancarSuplementacao={/** @type {Record<string, unknown>} */ (permissions).lancar_suplementacao === true}
              onSubmit={handleMovimentacao}
              onCancel={() => {
                setAreaDestinoPreSelecionada(null);
                setShowMovimentacao(false);
              }} />
      </LancLoteDialogo>

      <LancLoteDialogo open={showMorte} onOpenChange={setShowMorte} titulo="Registrar Morte" lotes={lotes}>
          {showMorte &&
            <FormularioMorte
              lote={lotes}
              onSubmit={handleMorte}
              enviando={enviandoBaixa}
              onCancel={() => setShowMorte(false)} />

            }
      </LancLoteDialogo>

      <LancLoteDialogo open={showNascimento} onOpenChange={setShowNascimento} titulo="Registrar Nascimento" lotes={lotes}>
          {showNascimento &&
            <FormularioNascimento
              lote={lotes}
              onSubmit={handleNascimento}
              onCancel={() => setShowNascimento(false)} />

            }
      </LancLoteDialogo>

      <LancLoteDialogo open={showAbate} onOpenChange={setShowAbate} titulo="Registrar Saída" lotes={lotes}>
          {showAbate &&
            <FormularioAbate
              lote={lotes}
              onSubmit={handleAbate}
              enviando={enviandoBaixa}
              onCancel={() => setShowAbate(false)} />

            }
      </LancLoteDialogo>

      <LancLoteDialogo open={showMudancaCategoria} onOpenChange={setShowMudancaCategoria} titulo="Mudança de Categoria" lotes={lotes}>
          <FormularioMudancaCategoria
              lote={lotes}
              onSubmit={handleMudancaCategoria}
              onCancel={() => setShowMudancaCategoria(false)} />
      </LancLoteDialogo>

      <LancLoteDialogo open={showPesagem} onOpenChange={setShowPesagem} titulo="Registrar Pesagem" lotes={lotes}>
          {showPesagem &&
            <FormularioPesagem
              lote={lotes}
              onSubmit={handlePesagem}
              onCancel={() => setShowPesagem(false)} />

            }
      </LancLoteDialogo>

      <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico de Movimentação" lotes={lotes} largo somenteLeitura>
          <HistoricoMovimentacoes lotes={lotes} areaId={areaAtual?.id} />
      </LancLoteDialogo>

      <LancLoteDialogo open={showHistoricoSupl} onOpenChange={setShowHistoricoSupl} titulo="Histórico de Suplementação" lotes={lotes} largo somenteLeitura>
          {lotes.map((lote, i) =>
            <div key={lote.id} className={i > 0 ? "mk-hist__separador" : undefined}>
              <HistoricoSuplementacaoLote loteId={lote.id} loteNome={lote.nome} />
            </div>
          )}
      </LancLoteDialogo>

      {/* Dialog Editar Informação (renomear o lote; no ledger, a posição) */}
      <LancLoteDialogo open={showRenomear} onOpenChange={setShowRenomear} titulo="Editar Informação" lotes={loteParaRenomear ? [loteParaRenomear] : lotes}>
          {!loteParaRenomear && lotes.length > 1 ?
            <div className="mk-ll">
              <p className="mk-ll__texto">{modoLedger ? 'Selecione o grupo desta área para editar:' : 'Selecione o lote para renomear:'}</p>
              {lotes.map((l) =>
              <button type="button" key={l.id} className="mk-ll__opcao" onClick={() => {
                setLoteParaRenomear(l);
                setNovoNomeLote(l.nome);
              }}>
                  <span>{l.nome}</span>
                  <span>{l.quantidade_cabecas} cab · {l.categoria}{modoLedger && l.area_atual_nome ? ` · ${l.area_atual_nome}` : ''}</span>
                </button>
              )}
            </div> :
            loteParaRenomear && modoLedger ?
            <EditarInformacaoPosicaoForm
              posicao={loteParaRenomear}
              empresaSelecionadaId={empresaSelecionadaId}
              onSalvo={(atualizada) => {
                // A posição aparece já com os valores gravados nas duas consultas que
                // o mapa usa (Detalhes e MapaGeral). Sem invalidar essas duas aqui: o
                // refetch não forçado (< 60 s) devolveria o IndexedDB antigo por cima.
                // Quem relê do servidor é o 'atualizar-mapa' (refresh forçado, que
                // também grava o IndexedDB).
                const aplicar = (dados) =>
                  Array.isArray(dados) ? dados.map((x) => (x?.id === atualizada?.id ? { ...x, ...atualizada } : x)) : dados;
                queryClient.setQueriesData({ queryKey: ['mapa-lotes', empresaSelecionadaId] }, aplicar);
                queryClient.setQueriesData({ queryKey: ['mapa-cache', 'lotes', empresaSelecionadaId] }, aplicar);
                queryClient.invalidateQueries({ queryKey: ['lotes'] });
                window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['lotes'] } }));
                setShowRenomear(false);
                onClose();
              }}
              onCancel={() => setShowRenomear(false)} /> :
            loteParaRenomear ?
            <RenomearLoteForm
              lote={loteParaRenomear}
              novoNome={novoNomeLote}
              onNovoNomeChange={setNovoNomeLote}
              empresaSelecionadaId={empresaSelecionadaId}
              areas={areas}
              onClose={() => {
                setShowRenomear(false);
                onClose();
                window.dispatchEvent(new CustomEvent('atualizar-mapa'));
              }}
              onCancel={() => setShowRenomear(false)} /> :

            null}
      </LancLoteDialogo>

    </div>

    <Dialog open={progresso.show} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Processando...</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-slate-600">{progresso.mensagem}</p>
          <Progress value={progresso.atual / progresso.total * 100} className="w-full h-1.5" />
        </div>
      </DialogContent>
    </Dialog>
    </>);

}