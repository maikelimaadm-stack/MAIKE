import React, { useState } from "react";

import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import FormularioMovimentacaoLote from "../lotes/FormularioMovimentacaoLote";
import FormularioMorte from "../lotes/FormularioMorte";
import FormularioNascimento from "../lotes/FormularioNascimento";
import FormularioAbate from "../lotes/FormularioAbate";
import FormularioMudancaCategoria from "../lotes/FormularioMudancaCategoria";
import FormularioPesagem from "../lotes/FormularioPesagem";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import HistoricoSuplementacaoLote from "../suplementacao/HistoricoSuplementacaoLote";
import ResumoSuplementacao from "../suplementacao/ResumoSuplementacao";
import { Progress } from "@/components/ui/progress";
import ResumoPasto from "./ResumoPasto";
import ResumoLoteDashboard from "./ResumoLoteDashboard";
import ComposicaoCategoria from "./ComposicaoCategoria";
import BotoesAcaoLote from "./BotoesAcaoLote";

export default function DetalhesLote({ lotes, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showMovimentacao, setShowMovimentacao] = useState(false);
  const [showMorte, setShowMorte] = useState(false);
  const [showNascimento, setShowNascimento] = useState(false);
  const [showAbate, setShowAbate] = useState(false);
  const [showMudancaCategoria, setShowMudancaCategoria] = useState(false);
  const [showPesagem, setShowPesagem] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [showHistoricoSupl, setShowHistoricoSupl] = useState(false);
  const [showRenomear, setShowRenomear] = useState(false);
  const [novoNomeLote, setNovoNomeLote] = useState('');
  const [loteParaRenomear, setLoteParaRenomear] = useState(null);
  const [showConfirmPesagem, setShowConfirmPesagem] = useState(false);
  const [lotesAtualizados, setLotesAtualizados] = useState(null);
  const [movimentacaoPendente, setMovimentacaoPendente] = useState(null);
  const [registrarPesagemAposMovimentacao, setRegistrarPesagemAposMovimentacao] = useState(false);
  const [movimentacoesCriadasIds, setMovimentacoesCriadasIds] = useState([]);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ['detalhes-lote-user'], queryFn: () => base44.auth.me() });

  // Listener para abrir movimentação via drag-and-drop
  React.useEffect(() => {
    const handleOpenMovimentacao = (e) => {
      setShowMovimentacao(true);
    };

    window.addEventListener('open-movimentacao', handleOpenMovimentacao);
    return () => {
      window.removeEventListener('open-movimentacao', handleOpenMovimentacao);
      delete window.areaDestinoArrastada;
    };
  }, []);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones-global'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.ativo !== false);
    },
  });

  // Calcular total de cabeças
  const totalCabecas = lotes.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const areaAtual = areas.find(a => a.id === lotes[0]?.area_atual_id);

  const movimentacaoMutation = useMutation({
    mutationFn: async (formData) => {
      console.log('🔄 INICIANDO MOVIMENTAÇÃO');
      const areaSaida = areas.find(a => a.id === formData.area_saida_id);
      const areaEntrada = areas.find(a => a.id === formData.area_entrada_id);
      const movimentacoesCriadas = [];
      const todosLotesSistema = await base44.entities.Lote.list();
      const lotesDestinoAtivos = todosLotesSistema.filter(l =>
        l.empresa_id === empresaSelecionadaId &&
        l.area_atual_id === formData.area_entrada_id &&
        l.status === 'Ativo'
      );
      const encontrarLoteDestinoCompativel = (loteOrigem, categoriaMovimento) => {
        return lotesDestinoAtivos.find(l =>
          l.area_atual_id === formData.area_entrada_id &&
          (l.categoria || '').toUpperCase() === categoriaMovimento &&
          (l.sexo || '') === (loteOrigem.sexo || '') &&
          (l.categoria_manejo_id || l.categoria_manejo_nome || '') === (loteOrigem.categoria_manejo_id || loteOrigem.categoria_manejo_nome || '') &&
          l.status === 'Ativo'
        );
      };
      
      // Movimentação - os eventos já foram fechados no FormularioMovimentacaoLote
      if (formData.mover_todos === 'sim') {
        for (const lote of lotes) {
          await base44.entities.Lote.update(lote.id, {
            area_atual_id: formData.area_entrada_id,
            area_atual_nome: areaEntrada?.nome || ''
          });

          const movimentacaoCriada = await base44.entities.MovimentacaoMapa.create({
            empresa_id: empresaSelecionadaId,
            data_movimentacao: new Date(formData.data_movimentacao).toISOString(),
            tipo: 'Transferência de Área',
            lote: lote.nome,
            lote_id: lote.id,
            quantidade_animais: lote.quantidade_cabecas,
            area_origem_id: formData.area_saida_id,
            area_origem_nome: areaSaida?.nome || '',
            area_destino_id: formData.area_entrada_id,
            area_destino_nome: areaEntrada?.nome || '',
            usuario_responsavel: user?.email || null,
            observacoes: `Movimentação completa do lote - ${lote.quantidade_cabecas} cabeças`
          });
          movimentacoesCriadas.push(movimentacaoCriada);
        }
      } else {
        for (const mov of formData.movimentacoes) {
          if (mov.quantidade <= 0) continue;

          const lotesCategoria = lotes.filter(l => l.categoria?.toUpperCase() === mov.categoria);
          let quantidadeRestante = Number(mov.quantidade || 0);
          const deveUnir = formData.unir_lotes[mov.categoria] === 'sim';

          for (const lote of lotesCategoria) {
            if (quantidadeRestante <= 0) break;

            const quantidadeMover = Math.min(quantidadeRestante, lote.quantidade_cabecas || 0);
            if (quantidadeMover <= 0) continue;
            const loteExistente = deveUnir ? encontrarLoteDestinoCompativel(lote, mov.categoria) : null;

            if (quantidadeMover === (lote.quantidade_cabecas || 0)) {
              if (deveUnir && loteExistente) {
                await base44.entities.Lote.update(loteExistente.id, {
                  quantidade_cabecas: (loteExistente.quantidade_cabecas || 0) + quantidadeMover
                });
                loteExistente.quantidade_cabecas = (loteExistente.quantidade_cabecas || 0) + quantidadeMover;
                await base44.entities.Lote.update(lote.id, { status: 'Inativo', quantidade_cabecas: 0 });
              } else {
                await base44.entities.Lote.update(lote.id, {
                  area_atual_id: formData.area_entrada_id,
                  area_atual_nome: areaEntrada?.nome || ''
                });
              }
            } else {
              if (deveUnir && loteExistente) {
                await base44.entities.Lote.update(loteExistente.id, {
                  quantidade_cabecas: (loteExistente.quantidade_cabecas || 0) + quantidadeMover
                });
                loteExistente.quantidade_cabecas = (loteExistente.quantidade_cabecas || 0) + quantidadeMover;
              } else {
                const novoLote = await base44.entities.Lote.create({
                  empresa_id: empresaSelecionadaId,
                  nome: lote.nome,
                  quantidade_cabecas: quantidadeMover,
                  categoria: lote.categoria,
                  sexo: lote.sexo,
                  peso_medio_kg: lote.peso_medio_kg,
                  idade_media_meses: lote.idade_media_meses,
                  area_atual_id: formData.area_entrada_id,
                  area_atual_nome: areaEntrada?.nome || '',
                  raca_predominante: lote.raca_predominante,
                  sistema_produtivo: lote.sistema_produtivo,
                  categoria_manejo_id: lote.categoria_manejo_id,
                  categoria_manejo_nome: lote.categoria_manejo_nome,
                  data_entrada: formData.data_movimentacao,
                  origem: 'MOVIMENTAÇÃO',
                  status: 'Ativo'
                });
                lotesDestinoAtivos.push(novoLote);
              }

              const saldoRemanescente = Math.max(0, (lote.quantidade_cabecas || 0) - quantidadeMover);
              await base44.entities.Lote.update(lote.id, {
                quantidade_cabecas: saldoRemanescente,
                status: saldoRemanescente > 0 ? lote.status : 'Inativo'
              });
            }

            const movimentacaoCriada = await base44.entities.MovimentacaoMapa.create({
              empresa_id: empresaSelecionadaId,
              data_movimentacao: new Date(formData.data_movimentacao).toISOString(),
              tipo: 'Transferência de Área',
              lote: lote.nome,
              lote_id: lote.id,
              quantidade_animais: quantidadeMover,
              area_origem_id: formData.area_saida_id,
              area_origem_nome: areaSaida?.nome || '',
              area_destino_id: formData.area_entrada_id,
              area_destino_nome: areaEntrada?.nome || '',
              usuario_responsavel: user?.email || null,
              observacoes: `Movimentação parcial - ${quantidadeMover} cabeças de ${mov.categoria}`
            });
            movimentacoesCriadas.push(movimentacaoCriada);

            quantidadeRestante -= quantidadeMover;
          }

          if (quantidadeRestante > 0) {
            throw new Error(`Não foi possível mover toda a quantidade solicitada da categoria ${mov.categoria}.`);
          }
        }
      }

      return movimentacoesCriadas;
      
      },
      onSuccess: async (movimentacoesCriadas, variables) => {
        toast.success('Gado movido com sucesso!');
        setShowMovimentacao(false);
        window.dispatchEvent(new CustomEvent('atualizar-mapa'));
        queryClient.invalidateQueries({ queryKey: ['lotes'] });
        queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] });

        const lotesNovos = await base44.entities.Lote.list();
        const categoriasMovidas = variables.mover_todos === 'sim'
          ? [...new Set(lotes.map(l => (l.categoria || '').toUpperCase()))]
          : [...new Set((variables.movimentacoes || []).filter(m => Number(m.quantidade) > 0).map(m => (m.categoria || '').toUpperCase()))];
        const nomesOrigem = new Set(lotes.map(l => l.nome));
        const lotesDestino = lotesNovos.filter(l =>
          l.empresa_id === empresaSelecionadaId &&
          l.area_atual_id === variables.area_entrada_id &&
          l.status === 'Ativo' &&
          (nomesOrigem.has(l.nome) || categoriasMovidas.includes((l.categoria || '').toUpperCase()))
        );

        setMovimentacaoPendente(null);
        setMovimentacoesCriadasIds((movimentacoesCriadas || []).map(item => item.id).filter(Boolean));

        if (registrarPesagemAposMovimentacao) {
          setLotesAtualizados(lotesDestino.length > 0 ? lotesDestino : lotes);
          setShowPesagem(true);
          return;
        }

        setLotesAtualizados(null);
        setMovimentacoesCriadasIds([]);
        onClose();
      },
    onError: (error) => {
      console.error('❌ Erro:', error);
      setMovimentacaoPendente(null);
      setMovimentacoesCriadasIds([]);
      toast.error('❌ Erro ao mover gado');
    }
  });

  const handleMovimentacao = async (formData) => {
    setMovimentacaoPendente(formData);
    setShowConfirmPesagem(true);
  };

  const handleMorte = async (formData) => {
    const lotesCategoria = lotes.filter(l => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaMorte = areas.find(a => a.id === areaAtualId);

    for (const lote of lotesCategoria) {
      const qtdRemover = Math.min(formData.quantidade, lote.quantidade_cabecas || 0);
      if (qtdRemover <= 0) continue;

      await base44.entities.MovimentacaoMapa.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: new Date(formData.data_ocorrencia).toISOString(),
        tipo: 'Morte',
        lote: lote.nome,
        lote_id: lote.id,
        quantidade_animais: qtdRemover,
        area_origem_id: areaAtualId,
        area_origem_nome: areaMorte?.nome || '',
        observacoes: `Categoria: ${formData.categoria}. Sexo: ${lote.sexo}. Causa: ${formData.causa_morte}. ${formData.observacoes}`
      });

      const novaQtd = Math.max(0, (lote.quantidade_cabecas || 0) - qtdRemover);
      await base44.entities.Lote.update(lote.id, {
        quantidade_cabecas: novaQtd,
        status: novaQtd > 0 ? lote.status : 'Inativo'
      });

      formData.quantidade -= qtdRemover;
      if (formData.quantidade <= 0) break;
    }

    toast.success('Morte registrada');
    setShowMorte(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleNascimento = async (formData) => {
    // Determinar categoria baseada no sexo
    const categoriaFilhote = formData.sexo === "Macho" 
      ? "Bezerro 0 a 12 meses" 
      : "Bezerra 0 a 12 meses";

    // Buscar lote da categoria correta na mesma área
    const areaAtualId = lotes[0]?.area_atual_id;
    const todosLotes = await base44.entities.Lote.list();
    let loteFilhote = todosLotes.find(l => 
      l.empresa_id === empresaSelecionadaId && 
      l.categoria === categoriaFilhote && 
      l.area_atual_id === areaAtualId &&
      l.status === 'Ativo'
    );

    if (loteFilhote) {
      // Adicionar ao lote existente
      await base44.entities.Lote.update(loteFilhote.id, {
        quantidade_cabecas: loteFilhote.quantidade_cabecas + formData.quantidade,
        peso_medio_kg: formData.peso_medio ? parseFloat(formData.peso_medio) : loteFilhote.peso_medio_kg
      });
    } else {
      // Criar novo lote
      const areaAtual = areas.find(a => a.id === areaAtualId);
      loteFilhote = await base44.entities.Lote.create({
        empresa_id: empresaSelecionadaId,
        nome: `${categoriaFilhote.split(' ')[0].toUpperCase()} - ${areaAtual?.nome || 'AREA'}`,
        quantidade_cabecas: formData.quantidade,
        categoria: categoriaFilhote,
        sexo: formData.sexo,
        peso_medio_kg: formData.peso_medio ? parseFloat(formData.peso_medio) : null,
        idade_media_meses: 0,
        area_atual_id: areaAtualId,
        area_atual_nome: areaAtual?.nome || '',
        data_entrada: formData.data_nascimento,
        origem: 'Nascimento',
        status: 'Ativo',
        sistema_produtivo: lotes[0]?.sistema_produtivo
      });
    }

    const areaNascimento = areas.find(a => a.id === areaAtualId);

    // Registrar movimentação
    await base44.entities.MovimentacaoMapa.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_nascimento).toISOString(),
      tipo: 'Nascimento',
      lote: loteFilhote.nome,
      lote_id: loteFilhote.id,
      quantidade_animais: formData.quantidade,
      peso_medio: parseFloat(formData.peso_medio) || null,
      area_destino_id: areaAtualId,
      area_destino_nome: areaNascimento?.nome || '',
      observacoes: `Categoria mãe: ${formData.categoria_mae}. Sexo: ${formData.sexo}. Categoria filhote: ${categoriaFilhote}. ${formData.observacoes}`
    });

    toast.success('Nascimento registrado');
    setShowNascimento(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleAbate = async (formData) => {
    const lotesCategoria = lotes.filter(l => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaAbate = areas.find(a => a.id === areaAtualId);

    for (const lote of lotesCategoria) {
      const qtdRemover = Math.min(formData.quantidade, lote.quantidade_cabecas || 0);
      if (qtdRemover <= 0) continue;

      await base44.entities.MovimentacaoMapa.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: new Date(formData.data_abate).toISOString(),
        tipo: 'Abate',
        lote: lote.nome,
        lote_id: lote.id,
        quantidade_animais: qtdRemover,
        area_origem_id: areaAtualId,
        area_origem_nome: areaAbate?.nome || '',
        observacoes: `Categoria: ${formData.categoria}. Sexo: ${lote.sexo}. Peso vivo: ${formData.peso_vivo_total}kg. Peso carcaça: ${formData.peso_carcaca_total}kg. Destino: ${formData.destino}. ${formData.observacoes}`
      });

      const novaQtd = Math.max(0, (lote.quantidade_cabecas || 0) - qtdRemover);
      await base44.entities.Lote.update(lote.id, {
        quantidade_cabecas: novaQtd,
        status: novaQtd > 0 ? lote.status : 'Inativo'
      });

      formData.quantidade -= qtdRemover;
      if (formData.quantidade <= 0) break;
    }

    toast.success('Abate registrado');
    setShowAbate(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleMudancaCategoria = async (formData) => {
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaMudanca = areas.find(a => a.id === areaAtualId);

    for (const mudanca of formData.mudancas) {
      const lotesCategoria = lotes.filter(l => l.categoria === mudanca.categoria_atual);
      let quantidadeRestante = mudanca.quantidade;

      for (const lote of lotesCategoria) {
        if (quantidadeRestante <= 0) break;

        const qtdMudar = Math.min(quantidadeRestante, lote.quantidade_cabecas);

        await base44.entities.MovimentacaoMapa.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: new Date(formData.data_mudanca).toISOString(),
          tipo: 'Mudança de Categoria',
          lote: lote.nome,
          lote_id: lote.id,
          quantidade_animais: qtdMudar,
          area_origem_id: areaAtualId,
          area_origem_nome: areaMudanca?.nome || '',
          observacoes: `De ${mudanca.categoria_atual} para ${mudanca.categoria_nova}. Sexo: ${lote.sexo}. ${formData.observacoes}`
        });

        if (qtdMudar === lote.quantidade_cabecas) {
          // Mudar categoria do lote todo
          await base44.entities.Lote.update(lote.id, {
            categoria: mudanca.categoria_nova
          });
        } else {
          // Mudança parcial - criar novo lote com nova categoria
          await base44.entities.Lote.create({
            empresa_id: empresaSelecionadaId,
            nome: lote.nome,
            quantidade_cabecas: qtdMudar,
            categoria: mudanca.categoria_nova,
            sexo: lote.sexo,
            peso_medio_kg: lote.peso_medio_kg,
            idade_media_meses: lote.idade_media_meses,
            area_atual_id: areaAtualId,
            area_atual_nome: areaMudanca?.nome || '',
            raca_predominante: lote.raca_predominante,
            sistema_produtivo: lote.sistema_produtivo,
            data_entrada: formData.data_mudanca,
            origem: 'Mudança de Categoria',
            status: 'Ativo'
          });

          // Diminuir quantidade do lote original
          await base44.entities.Lote.update(lote.id, {
            quantidade_cabecas: lote.quantidade_cabecas - qtdMudar
          });
        }

        quantidadeRestante -= qtdMudar;
      }
    }

    toast.success('Categorias atualizadas');
    setShowMudancaCategoria(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handlePesagem = async (formData) => {
    const lotesParaPesar = lotesAtualizados || lotes;
    const areaAtualId = lotesParaPesar[0]?.area_atual_id;
    const areaPesagem = areas.find(a => a.id === areaAtualId);
    const vinculoPesagem = movimentacoesCriadasIds.length > 0 ? `[PESAGEM_VINCULADA:${movimentacoesCriadasIds.join(',')}] ` : '';

    // Se há pesos individuais por lote, usar esses; senão usar por categoria
    const pesosIndividuais = formData.pesos_por_lote || {};

    for (const categoria of formData.categorias_selecionadas) {
      const lotesCategoria = lotesParaPesar.filter(l => l.categoria === categoria);
      const pesoPadrao = parseFloat(formData.pesos_por_categoria[categoria]);

      for (const lote of lotesCategoria) {
        // Verificar se tem peso individual para este lote específico
        const pesoNovo = pesosIndividuais[lote.id] ? parseFloat(pesosIndividuais[lote.id]) : pesoPadrao;
        if (!pesoNovo || pesoNovo <= 0) continue;

        const pesoAnterior = lote.peso_medio_kg || 0;
        const ganho = pesoNovo - pesoAnterior;

        await base44.entities.MovimentacaoMapa.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: new Date(formData.data_pesagem).toISOString(),
          tipo: 'Pesagem',
          lote: lote.nome,
          lote_id: lote.id,
          quantidade_animais: lote.quantidade_cabecas,
          peso_medio: pesoNovo,
          area_origem_id: areaAtualId,
          area_origem_nome: areaPesagem?.nome || '',
          observacoes: `${vinculoPesagem}Categoria: ${categoria}. Sexo: ${lote.sexo}. Peso anterior: ${pesoAnterior}kg. Ganho: ${ganho.toFixed(1)}kg. ${formData.observacoes}`
        });

        await base44.entities.Lote.update(lote.id, {
          peso_medio_kg: pesoNovo
        });
      }
    }

    toast.success('Pesagens registradas');
    setShowPesagem(false);
    setMovimentacoesCriadasIds([]);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  // Juntar lotes logic
  const categoriasUnicas = [...new Set(lotes.map(l => (l.categoria || '').toUpperCase()))];
  const categoriasManejoUnicas = [...new Set(lotes.map(l => l.categoria_manejo_id || l.categoria_manejo_nome || 'SEM_CATEGORIA_MANEJO'))];
  const mesmaCat = categoriasUnicas.length === 1;
  const mesmaCategoriaManejo = categoriasManejoUnicas.length === 1;
  const podeJuntar = mesmaCat && mesmaCategoriaManejo;
  const motivoNaoJuntar = !mesmaCat ? 'Só é possível juntar lotes da mesma categoria' : !mesmaCategoriaManejo ? 'Não é possível juntar lotes com categoria de manejo diferente' : '';

  const handleJuntar = async () => {
    if (!mesmaCat) { alert('Não é possível juntar lotes de categorias diferentes.'); return; }
    if (!mesmaCategoriaManejo) { alert('Não é possível juntar lotes com categoria de manejo diferente.'); return; }
    if (!confirm(`Deseja juntar todos os ${lotes.length} lotes desta área em um único lote?`)) return;
    const principal = lotes[0];
    const totalCab = lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
    const pesoTotal = lotes.reduce((s, l) => s + ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)), 0);
    const pesoMedio = totalCab > 0 ? pesoTotal / totalCab : 0;
    const snapshotLotes = lotes.map(l => ({ id: l.id, nome: l.nome, quantidade_cabecas: l.quantidade_cabecas || 0, peso_medio_kg: l.peso_medio_kg || 0, status: l.status || 'Ativo', categoria: l.categoria || '', categoria_manejo_id: l.categoria_manejo_id || '', categoria_manejo_nome: l.categoria_manejo_nome || '', area_atual_id: l.area_atual_id || '', area_atual_nome: l.area_atual_nome || '' }));
    const nomesLotes = lotes.map(l => l.nome).join(', ');
    for (let i = 1; i < lotes.length; i++) { await base44.entities.Lote.update(lotes[i].id, { status: 'Inativo', quantidade_cabecas: 0 }); }
    await base44.entities.Lote.update(principal.id, { quantidade_cabecas: totalCab, peso_medio_kg: pesoMedio > 0 ? Math.round(pesoMedio * 10) / 10 : principal.peso_medio_kg });
    const areaAtualId = principal.area_atual_id;
    const areaJuncao = areas.find(a => a.id === areaAtualId);
    await base44.entities.MovimentacaoMapa.create({ empresa_id: empresaSelecionadaId, data_movimentacao: new Date().toISOString(), tipo: 'Entrada', motivo: 'Junção de Lotes', lote: principal.nome, lote_id: principal.id, quantidade_animais: totalCab, area_origem_id: areaAtualId, area_origem_nome: areaJuncao?.nome || '', observacoes: `[JUNCAO_LOTES]${JSON.stringify(snapshotLotes)}\nJunção de Lotes: ${nomesLotes} → ${principal.nome}. Total: ${totalCab} cabeças.` });
    toast.success(`Lotes unificados! ${totalCab} cabeças no lote "${principal.nome}"`);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  return (
    <>
    <div className="space-y-2" translate="no">
      {/* 1. Resumo do Pasto */}
      <ResumoPasto area={areaAtual} lotes={lotes} />

      {/* 2. Resumo dos Lotes */}
      <ResumoLoteDashboard lotes={lotes} areaAtual={areaAtual} />

      {/* 3. Composição por Categoria */}
      <ComposicaoCategoria lotes={lotes} />

      {/* 4. Suplementação Integrada */}
      <ResumoSuplementacao lotesIds={lotes.map(l => l.id)} modo="completo" />

      {/* 5. Botões de Ação Agrupados */}
      <BotoesAcaoLote
        lotes={lotes}
        onMover={() => setShowMovimentacao(true)}
        onPesar={() => setShowPesagem(true)}
        onMudarCategoria={() => setShowMudancaCategoria(true)}
        onNascimento={() => setShowNascimento(true)}
        onMorte={() => setShowMorte(true)}
        onAbate={() => setShowAbate(true)}
        onHistorico={() => setShowHistorico(true)}
        onHistoricoSupl={() => setShowHistoricoSupl(true)}
        onRenomear={() => {
          if (lotes.length === 1) { setLoteParaRenomear(lotes[0]); setNovoNomeLote(lotes[0].nome); }
          else { setLoteParaRenomear(null); }
          setShowRenomear(true);
        }}
        onJuntar={handleJuntar}
        podeJuntar={podeJuntar}
        motivoNaoJuntar={motivoNaoJuntar}
      />

      <Dialog open={showMovimentacao} onOpenChange={setShowMovimentacao}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Movimentação de Lotes</DialogTitle>
          </DialogHeader>
          <FormularioMovimentacaoLote
            lotesOriginais={lotes}
            areaOrigem={areaAtual}
            onSubmit={handleMovimentacao}
            onCancel={() => setShowMovimentacao(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showMorte} onOpenChange={setShowMorte}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Morte</DialogTitle></DialogHeader>
          {showMorte && (
            <FormularioMorte
              lote={lotes}
              onSubmit={handleMorte}
              onCancel={() => setShowMorte(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showNascimento} onOpenChange={setShowNascimento}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Nascimento</DialogTitle></DialogHeader>
          {showNascimento && (
            <FormularioNascimento
              lote={lotes}
              onSubmit={handleNascimento}
              onCancel={() => setShowNascimento(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAbate} onOpenChange={setShowAbate}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Abate</DialogTitle></DialogHeader>
          {showAbate && (
            <FormularioAbate
              lote={lotes}
              onSubmit={handleAbate}
              onCancel={() => setShowAbate(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showMudancaCategoria} onOpenChange={setShowMudancaCategoria}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Mudança de Categoria</DialogTitle></DialogHeader>
          <FormularioMudancaCategoria
            lote={lotes}
            onSubmit={handleMudancaCategoria}
            onCancel={() => setShowMudancaCategoria(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showPesagem} onOpenChange={(open) => { setShowPesagem(open); if (!open) { setLotesAtualizados(null); setMovimentacoesCriadasIds([]); } }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Pesagem</DialogTitle></DialogHeader>
          {showPesagem && (
            <FormularioPesagem
              lote={lotesAtualizados || lotes}
              onSubmit={handlePesagem}
              onCancel={() => { setShowPesagem(false); setLotesAtualizados(null); setMovimentacoesCriadasIds([]); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Histórico de Movimentações</DialogTitle></DialogHeader>
          <HistoricoMovimentacoes lotes={lotes} areaId={areaAtual?.id} />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistoricoSupl} onOpenChange={setShowHistoricoSupl}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Histórico de Suplementação</DialogTitle></DialogHeader>
          {lotes.length === 1 ? (
            <HistoricoSuplementacaoLote
              loteId={lotes[0].id}
              loteNome={lotes[0].nome}
            />
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Histórico de Suplementação</h3>
              {lotes.map(lote => (
                <div key={lote.id} className="border-t pt-4">
                  <HistoricoSuplementacaoLote
                    loteId={lote.id}
                    loteNome={lote.nome}
                  />
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Renomear Lote */}
      <Dialog open={showRenomear} onOpenChange={setShowRenomear}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Renomear Lote</DialogTitle></DialogHeader>
          {!loteParaRenomear && lotes.length > 1 ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">Selecione o lote para renomear:</p>
              {lotes.map(l => (
                <Button key={l.id} variant="outline" className="w-full h-9 text-xs justify-start" onClick={() => {
                  setLoteParaRenomear(l);
                  setNovoNomeLote(l.nome);
                }}>
                  {l.nome} ({l.quantidade_cabecas} cab - {l.categoria})
                </Button>
              ))}
            </div>
          ) : loteParaRenomear ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">Lote atual: <strong>{loteParaRenomear.nome}</strong></p>
              <div>
                <Label className="text-xs">Novo nome</Label>
                <Input value={novoNomeLote} onChange={e => setNovoNomeLote(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowRenomear(false)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                  if (!novoNomeLote.trim()) return;
                  const nomeAnterior = loteParaRenomear.nome;
                  await base44.entities.Lote.update(loteParaRenomear.id, { nome: novoNomeLote.trim() });
                  
                  // Registrar no histórico
                  const areaAtualId = loteParaRenomear.area_atual_id;
                  const areaRen = areas.find(a => a.id === areaAtualId);
                  await base44.entities.MovimentacaoMapa.create({
                    empresa_id: empresaSelecionadaId,
                    data_movimentacao: new Date().toISOString(),
                    tipo: 'Entrada',
                    motivo: 'Renomear Lote',
                    lote: novoNomeLote.trim(),
                    lote_id: loteParaRenomear.id,
                    quantidade_animais: loteParaRenomear.quantidade_cabecas || 0,
                    area_origem_id: areaAtualId,
                    area_origem_nome: areaRen?.nome || '',
                    observacoes: `Renomear Lote: "${nomeAnterior}" → "${novoNomeLote.trim()}"`
                  });
                  
                  toast.success('Lote renomeado!');
                  setShowRenomear(false);
                  onClose();
                  window.dispatchEvent(new CustomEvent('atualizar-mapa'));
                }}>Salvar</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar pesagem antes da movimentação */}
      <Dialog open={showConfirmPesagem} onOpenChange={setShowConfirmPesagem}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Abrir pesagem depois da movimentação?</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-600">Depois de confirmar a movimentação, deseja abrir a pesagem dos lotes movimentados?</p>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={!movimentacaoPendente || movimentacaoMutation.isPending}
              onClick={() => {
                setRegistrarPesagemAposMovimentacao(false);
                setShowConfirmPesagem(false);
                movimentacaoMutation.mutate(movimentacaoPendente);
              }}
            >
              Não
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
              disabled={!movimentacaoPendente || movimentacaoMutation.isPending}
              onClick={() => {
                setRegistrarPesagemAposMovimentacao(true);
                setShowConfirmPesagem(false);
                movimentacaoMutation.mutate(movimentacaoPendente);
              }}
            >
              Sim, Pesar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>

    <Dialog open={progresso.show} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Processando...</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-slate-600">{progresso.mensagem}</p>
          <Progress value={(progresso.atual / progresso.total) * 100} className="w-full h-1.5" />
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}