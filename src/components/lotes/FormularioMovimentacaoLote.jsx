import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa, listarTodosPontosSuplementacao } from "@/services/mapaService";
import { listarTodosLotes, listarEventosSuplementacao } from "@/services/loteManejoService";
import useSetorAreas from "@/hooks/useSetorAreas";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { calcularDiasPeriodo } from "../utils/consumoUtils";
import { fecharPeriodoSuplementacao } from "@/services/suplementacaoService";
import { getTodayLocalDate } from "../utils/pecuariaUtils";
import { LancLoteForm, LancLoteItens, LancLoteItem, LancLoteAdicionar, LancLoteRodape, LancLoteSegmento, LancLoteAviso, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import B1Select from "@/components/cadastro/base1/B1Select";
import LancField from "@/components/cadastro/base1/LancField";
import { notifyWarning, notifyError } from "@/lib/maikeNotify";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

/**
 * `podeLancarSuplementacao` (R4, PR #199): só quem tem "lançar suplementação"
 * fecha o consumo do cocho ou aproveita sobra no destino — o servidor recusa
 * (403) para os demais. Sem a permissão, o formulário NÃO oferece o fechamento:
 * avisa que o consumo continua aberto e segue para a movimentação.
 * Padrão `false` (o lado seguro).
 */
export default function FormularioMovimentacaoLote({ lotesOriginais, areaOrigem, areaDestinoPreSelecionada, onSubmit, onCancel, podeLancarSuplementacao = false }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [loading, setLoading] = useState(false);
  const [etapa, setEtapa] = useState('verificacao'); // 'verificacao', 'confirmar_consumo', 'fechamento_consumo', 'movimentacao'
  const [eventosAbertos, setEventosAbertos] = useState([]);
  const [consumoAbertoSemPermissao, setConsumoAbertoSemPermissao] = useState(0);
  const [mostrarPerguntaConsumo, setMostrarPerguntaConsumo] = useState(false);
  const [mostrarPerguntaSobraDestino, setMostrarPerguntaSobraDestino] = useState(false);
  const [sobrasDestinoPendentes, setSobrasDestinoPendentes] = useState([]);
  const [movimentacaoAguardandoSobra, setMovimentacaoAguardandoSobra] = useState(null);
  const [sobraDestinoDecidida, setSobraDestinoDecidida] = useState(false);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });
  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const [formData, setFormData] = useState(() => {
    const areaDestino = areaDestinoPreSelecionada;

    // Agrupar lotes por categoria e pré-preencher movimentações
    const categoriasPorLote = lotesOriginais.reduce((acc, lote) => {
      const cat = lote.categoria?.toUpperCase() || 'SEM CATEGORIA';
      if (!acc[cat]) {
        acc[cat] = {
          categoria: cat,
          quantidade_total: 0,
          peso_medio: lote.peso_medio_kg || 0,
          lotes: []
        };
      }
      acc[cat].quantidade_total += lote.quantidade_cabecas || 0;
      acc[cat].lotes.push(lote);
      return acc;
    }, {});

    const movimentacoesPre = Object.values(categoriasPorLote).map((cat) => ({
      categoria: cat.categoria,
      quantidade: cat.quantidade_total,
      peso_medio: cat.peso_medio,
      quantidade_maxima: cat.quantidade_total
    }));

    // Área de saída: priorizar areaOrigem, depois pegar do primeiro lote
    const areaSaidaId = areaOrigem?.id || lotesOriginais[0]?.area_atual_id || '';

    return {
      data_movimentacao: getTodayLocalDate(),
      mover_todos: 'sim',
      setor_saida_id: areaOrigem?.setor_id || '',
      area_saida_id: areaSaidaId,
      setor_entrada_id: '',
      area_entrada_id: areaDestino || '',
      movimentacoes: movimentacoesPre,
      sobras_cocho: {},
      sobras_destino_aproveitar: []
    };
  });

  React.useEffect(() => {
    if (!areaDestinoPreSelecionada) return;
    const areaDestino = areas.find((item) => item.id === areaDestinoPreSelecionada);
    setFormData((prev) => ({ ...prev, area_entrada_id: areaDestinoPreSelecionada, setor_entrada_id: areaDestino?.setor_id || prev.setor_entrada_id }));
  }, [areaDestinoPreSelecionada, areas]);

  React.useEffect(() => {
    const areaSaida = areas.find((item) => item.id === formData.area_saida_id);
    const areaEntrada = areas.find((item) => item.id === formData.area_entrada_id);
    setFormData((prev) => ({
      ...prev,
      setor_saida_id: areaSaida?.setor_id || prev.setor_saida_id,
      setor_entrada_id: areaEntrada?.setor_id || prev.setor_entrada_id,
    }));
  }, [areas, formData.area_saida_id, formData.area_entrada_id]);

  const areasSaida = formData.setor_saida_id ? getAreasBySetor(formData.setor_saida_id) : [];
  const areasEntrada = formData.setor_entrada_id ? getAreasBySetor(formData.setor_entrada_id).filter((item) => item.id !== formData.area_saida_id) : [];

  React.useEffect(() => {
    setSobraDestinoDecidida(false);
  }, [formData.area_entrada_id]);

  // Área de saída resolvida
  const areaSaidaResolvida = formData.area_saida_id || areaOrigem?.id || lotesOriginais[0]?.area_atual_id || '';

  // Verificar eventos abertos ao carregar
  React.useEffect(() => {
    const verificarEventosAbertos = async () => {
      if (!areaSaidaResolvida) return;

      try {
        const [todosPontos, todosEventos] = await Promise.all([
          listarTodosPontosSuplementacao(),
          listarEventosSuplementacao(),
        ]);

        const pontosById = todosPontos.reduce((acc, ponto) => {
          acc[ponto.id] = ponto;
          return acc;
        }, {});

        const abertos = todosEventos
          .filter((evento) => evento.empresa_id === empresaSelecionadaId)
          .filter((evento) => evento.dias_periodo === null || evento.dias_periodo === undefined)
          .filter((evento) => evento.area_id === areaSaidaResolvida || (Array.isArray(evento.area_ids) && evento.area_ids.includes(areaSaidaResolvida)))
          .map((evento) => ({
            ...evento,
            ponto_nome: pontosById[evento.ponto_suplementacao_id]?.nome_ponto || evento.ponto_nome || 'Cocho',
            ponto_id: evento.ponto_suplementacao_id,
          }));

        setEventosAbertos(abertos);

        if (abertos.length > 0 && !podeLancarSuplementacao) {
          // R4: sem "lançar suplementação" não há fechamento (o servidor recusa);
          // move sem tocar no consumo, que continua aberto — e diz isso.
          setConsumoAbertoSemPermissao(abertos.length);
          setEtapa('movimentacao');
        } else if (abertos.length > 0) {
          setMostrarPerguntaConsumo(true);
          setEtapa('confirmar_consumo');
          const sobrasIniciais = {};
          abertos.forEach((ev) => {
            sobrasIniciais[ev.id] = '0';
          });
          setFormData((prev) => ({ ...prev, sobras_cocho: sobrasIniciais }));
        } else {
          setEtapa('movimentacao');
        }
      } catch (error) {
        console.error('Erro ao verificar eventos:', error);
        setEtapa('movimentacao');
      }
    };

    verificarEventosAbertos();
  }, [areaSaidaResolvida, empresaSelecionadaId]);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const icones = await listarIconesDaEmpresa(empresaSelecionadaId);
      return icones.filter((i) => i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: todosLotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosLotes();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId
  });

  // Agrupar lotes por categoria
  const categoriasPorLote = lotesOriginais.reduce((acc, lote) => {
    const cat = lote.categoria?.toUpperCase() || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = {
        categoria: cat,
        quantidade_total: 0,
        peso_medio: lote.peso_medio_kg || 0,
        lotes: []
      };
    }
    acc[cat].quantidade_total += lote.quantidade_cabecas || 0;
    acc[cat].lotes.push(lote);
    return acc;
  }, {});

  const categorias = Object.values(categoriasPorLote);



  const adicionarMovimentacao = () => {
    const primeiraCategoria = categorias[0];
    setFormData((prev) => ({
      ...prev,
      movimentacoes: [...prev.movimentacoes, {
        categoria: primeiraCategoria.categoria,
        quantidade: "",
        peso_medio: primeiraCategoria.peso_medio,
        quantidade_maxima: primeiraCategoria.quantidade_total
      }]
    }));
  };

  const categoriasDisponiveis = categorias.map((c) => c.categoria);
  const totaisSolicitadosPorCategoria = formData.movimentacoes.reduce((acc, item) => {
    const categoria = item.categoria;
    acc[categoria] = (acc[categoria] || 0) + (parseFloat(item.quantidade) || 0);
    return acc;
  }, {});

  const handleMovimentacaoChange = (index, field, value) => {
    const novasMovimentacoes = [...formData.movimentacoes];
    novasMovimentacoes[index] = {
      ...novasMovimentacoes[index],
      [field]: field === 'quantidade' || field === 'peso_medio' ? value === '' ? '' : parseFloat(value) || 0 : value
    };
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleRemoveMovimentacao = (index) => {
    const novasMovimentacoes = formData.movimentacoes.filter((_, i) => i !== index);
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const buscarSobrasDestinoPendentes = async () => {
    if (!formData.area_entrada_id) return [];

    const [todosPontos, todosEventos] = await Promise.all([
      listarTodosPontosSuplementacao(),
      listarEventosSuplementacao(),
    ]);

    const cochosDestino = todosPontos.filter((ponto) => {
      const areaIds = Array.isArray(ponto.area_vinculada_ids) ? ponto.area_vinculada_ids.filter(Boolean) : [];
      const vinculadoNaArea = areaIds.includes(formData.area_entrada_id) || ponto.area_vinculada_id === formData.area_entrada_id;
      return ponto.empresa_id === empresaSelecionadaId && ponto.status !== 'Inativo' && String(ponto.categoria_ponto || '').toUpperCase() === 'COCHO' && vinculadoNaArea;
    });

    return cochosDestino.map((ponto) => {
      const ultimoEvento = todosEventos
        .filter((evento) => evento.empresa_id === empresaSelecionadaId && evento.ponto_suplementacao_id === ponto.id)
        .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];

      const sobraKg = Number(ultimoEvento?.sobra_kg || 0);
      if (!ultimoEvento || sobraKg <= 0 || ultimoEvento.dias_periodo == null) return null;

      return {
        ponto_id: ponto.id,
        ponto_nome: ponto.nome_ponto,
        produto: ultimoEvento.produto,
        produto_id: ultimoEvento.produto_id || null,
        tipo_consumo: ultimoEvento.tipo_consumo || null,
        sobra_kg: sobraKg,
        ultimo_lancamento_data: ultimoEvento.data_lancamento,
      };
    }).filter(Boolean);
  };

  const executarMovimentacao = async (dados, sobrasAproveitar = []) => {
    console.log('Enviando movimentação:', { ...dados, sobras_destino_aproveitar: sobrasAproveitar });
    setLoading(true);
    try {
      await onSubmit({ ...dados, sobras_destino_aproveitar: sobrasAproveitar });
    } finally {
      setLoading(false);
    }
  };

  const handleFecharEventos = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const totalPassos = eventosAbertos.reduce((sum, ev) => {
        const todosLotesSupl = [];
        return sum + 1 + todosLotesSupl.length;
      }, 0);
      let passoAtual = 0;

      setProgresso({ show: true, atual: 0, total: eventosAbertos.length * 2, mensagem: 'Iniciando fechamento...' });

      for (let i = 0; i < eventosAbertos.length; i++) {
        const evento = eventosAbertos[i];
        setProgresso({ show: true, atual: i * 2 + 1, total: eventosAbertos.length * 2, mensagem: `Fechando evento ${i + 1}/${eventosAbertos.length}...` });

        const sobra = parseFloat(formData.sobras_cocho[evento.id] || 0);
        const diasPeriodo = calcularDiasPeriodo(evento.data_lancamento, formData.data_movimentacao);
        const saldoFisicoMaximo = (evento.quantidade_total_kg || 0) + (evento.sobra_kg || 0);
        if (sobra < 0 || sobra > saldoFisicoMaximo) {
          throw new Error(`A sobra informada para ${evento.ponto_nome} está fora do limite físico do período.`);
        }

        setProgresso({ show: true, atual: i * 2 + 2, total: eventosAbertos.length * 2, mensagem: `Atualizando lotes ${i + 1}/${eventosAbertos.length}...` });

        await fecharPeriodoSuplementacao({
          evento,
          diasPeriodo,
          sobraInicial: evento.sobra_kg || 0,
          sobraFinal: sobra,
        });
      }

      setProgresso({ show: true, atual: eventosAbertos.length * 2, total: eventosAbertos.length * 2, mensagem: 'Concluído!' });

      setTimeout(() => {
        setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
        setEtapa('movimentacao');
      }, 500);

    } catch (error) {
      console.error('Erro ao fechar eventos:', error);
      setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
      notifyError('Erro', 'Erro ao fechar períodos de consumo');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    if (!formData.area_saida_id) {
      notifyWarning("Atenção", 'Selecione a área de saída');
      return;
    }

    if (!formData.area_entrada_id) {
      notifyWarning("Atenção", 'Selecione a área de entrada');
      return;
    }

    if (formData.mover_todos === 'nao') {
      if (formData.movimentacoes.length === 0) {
        notifyWarning("Atenção", 'Adicione pelo menos uma movimentação');
        return;
      }

      const temQuantidadeInvalida = formData.movimentacoes.some((m) => !m.quantidade || m.quantidade <= 0);
      if (temQuantidadeInvalida) {
        notifyWarning("Atenção", 'Todas as movimentações devem ter quantidade maior que zero');
        return;
      }

      const categoriasExcedidas = Object.entries(totaisSolicitadosPorCategoria).filter(([categoria, total]) => total > (categoriasPorLote[categoria]?.quantidade_total || 0));
      if (categoriasExcedidas.length > 0) {
        notifyWarning("Atenção", 'A soma movimentada por categoria excede o total disponível em um ou mais grupos.');
        return;
      }
    }

    // R2E-P1 (D-PROD-107): no ledger (posições) e sem conexão, não busca sobras
    // (a busca falharia em silêncio): segue para o envio, que recusa com
    // "Sem conexão" ANTES de qualquer requisição. O fluxo legado não muda.
    const ehLedger = lotesOriginais.some((l) => l?.__posicao === true);
    if (ehLedger && typeof navigator !== 'undefined' && navigator.onLine === false) {
      await executarMovimentacao(formData, []);
      return;
    }

    // R4: aproveitar sobra no destino grava suplementação — só com "lançar".
    if (!sobraDestinoDecidida && podeLancarSuplementacao) {
      const pendentes = await buscarSobrasDestinoPendentes();
      if (pendentes.length > 0) {
        setSobrasDestinoPendentes(pendentes);
        setMovimentacaoAguardandoSobra({ ...formData });
        setMostrarPerguntaSobraDestino(true);
        return;
      }
      setSobraDestinoDecidida(true);
    }

    await executarMovimentacao(formData, []);
  };

  if (etapa === 'verificacao') {
    return (
      <div className="mk-ll" role="status">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900 mx-auto"></div>
            <p className="text-xs text-slate-600 mt-4">Verificando eventos de suplementação abertos...</p>
          </div>
      </div>);

  }

  if (etapa === 'fechamento_consumo') {
    return (
      <>
      <LancLoteForm onSubmit={(e) => { e.preventDefault(); handleFecharEventos(); }}>
            {progresso.show &&
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-blue-900">{progresso.mensagem}</span>
                  <span className="text-xs text-blue-700">{progresso.atual}/{progresso.total}</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progresso.atual / progresso.total * 100}%` }}>
                </div>
                </div>
              </div>
            }
            <LancLoteAviso tom="ambar">
              <p className="mb-1 font-semibold">Fechamento de consumo necessário</p>
              <p className="mb-1">
                <strong>Atenção:</strong> Existem {eventosAbertos.length} evento(s) de suplementação em aberto na área de origem.
              </p>
              <p className="text-xs text-amber-800">
                Para mover o gado, é necessário fechar esses períodos informando a data do fechamento e quanto sobrou no cocho.
              </p>
            </LancLoteAviso>

            <FL label="Data do fechamento do consumo" required>
              <Input
                type="date"
                value={formData.data_movimentacao}
                onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })}
                className={LL_CTL}
                required
              />
            </FL>

            <LancLoteItens>
              {eventosAbertos.map((evento) => {
                const diasPeriodo = calcularDiasPeriodo(evento.data_lancamento, formData.data_movimentacao);
                return (
                  <LancLoteItem key={evento.id} titulo={evento.ponto_nome} sub={<div className="text-[10px] text-slate-600 mt-1 space-y-0.5">
                        <div>Lançamento: {new Date(evento.data_lancamento).toLocaleDateString()}</div>
                        <div>Produto: {evento.produto}</div>
                        <div>Quantidade fornecida: {evento.quantidade_total_kg.toFixed(1)} kg</div>
                        <div className="font-semibold text-blue-700">Período: {diasPeriodo} dia(s)</div>
                      </div>}>

                    <>
                      <FL label="Sobra no cocho (kg)" required>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max={(evento.quantidade_total_kg || 0) + (evento.sobra_kg || 0)}
                          value={formData.sobras_cocho[evento.id] || ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            sobras_cocho: {
                              ...formData.sobras_cocho,
                              [evento.id]: e.target.value
                            }
                          })}
                          className={LL_CTL}
                          placeholder="0.0"
                          required />
                      </FL>
                      <p className="text-[10px] text-slate-500">
                        Informe 0 se não sobrou nada no cocho
                      </p>
                    </>

                    <div className="mk-ll__cheio mk-ll__item-rodape">
                      <strong>Consumo calculado:</strong>{' '}
                      {(evento.quantidade_total_kg - parseFloat(formData.sobras_cocho[evento.id] || 0) + parseFloat(evento.sobra_kg || 0)).toFixed(1)} kg
                    </div>
                  </LancLoteItem>);

              })}
            </LancLoteItens>

            <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={loading || progresso.show} textoAcao="Fechar Consumos e Continuar" textoEnviando="Fechando..." enviando={loading || progresso.show} />
      </LancLoteForm>

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

  return (
    <>
    <LancLoteForm onSubmit={handleSubmit}>
          {consumoAbertoSemPermissao > 0 &&
          <LancLoteAviso tom="ambar">
              <p className="mb-1 font-semibold" data-testid="consumo-aberto-sem-permissao">Consumo do cocho continua aberto</p>
              <p className="text-xs text-amber-800">
                Há {consumoAbertoSemPermissao} consumo(s) de suplementação em aberto na área de origem. Seu perfil não fecha consumo nem
                aproveita sobra de cocho (permissão "Lançar suplementação"): o gado será movido e o consumo seguirá aberto até alguém
                com essa permissão fechá-lo.
              </p>
            </LancLoteAviso>
          }
          <div className="mk-ll__grade">
            <FL label="Data da Movimentação" required>
              <Input type="date" value={formData.data_movimentacao} onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })} className={LL_CTL} required />
            </FL>
            <LancLoteSegmento rotulo="Movimentar todo o lote?" required valor={formData.mover_todos} onChange={(v) => setFormData({ ...formData, mover_todos: v })} opcoes={[{ value: "sim", label: "Sim" }, { value: "nao", label: "Não" }]} />
          </div>
          <div className="mk-ll__grade">
            <FL label="Setor de saída" required>
              <B1Select value={formData.setor_saida_id || ''} onChange={(e) => { const v = e.target.value; setFormData({ ...formData, setor_saida_id: v === '__none__' ? '' : v, area_saida_id: '' }); }} className={LL_CTL}>
                  {setores.map((setor) =>
                  <option key={setor.id} value={setor.id}>{setor.nome}</option>
                  )}
              </B1Select>
            </FL>
            <FL label="Área e módulo de saída" required>
              <B1Select value={formData.area_saida_id || ''} onChange={(e) => { const v = e.target.value; setFormData({ ...formData, area_saida_id: v === '__none__' ? '' : v }); }} disabled={!formData.setor_saida_id} className={LL_CTL}>
                  {areasSaida.map((area) =>
                  <option key={area.id} value={area.id}>
                      {area.numero_area ? `${area.numero_area} - ${area.nome}` : area.nome}
                    </option>
                  )}
              </B1Select>
            </FL>
            <FL label="Setor de entrada" required>
              <B1Select value={formData.setor_entrada_id || ''} onChange={(e) => { const v = e.target.value; setFormData({ ...formData, setor_entrada_id: v === '__none__' ? '' : v, area_entrada_id: '' }); }} className={LL_CTL}>
                  {setores.map((setor) =>
                  <option key={setor.id} value={setor.id}>{setor.nome}</option>
                  )}
              </B1Select>
            </FL>
            <FL label="Área e módulo de entrada" required>
              <B1Select value={formData.area_entrada_id || ''} onChange={(e) => { const v = e.target.value; setFormData({ ...formData, area_entrada_id: v === '__none__' ? '' : v }); }} disabled={!formData.setor_entrada_id} className={LL_CTL}>
                  {areasEntrada.map((area) =>
                  <option key={area.id} value={area.id}>
                        {area.numero_area ? `${area.numero_area} - ${area.nome}` : area.nome}
                      </option>
                  )}
              </B1Select>
            </FL>
          </div>

          {formData.mover_todos === 'nao' &&
          <LancLoteItens>
              {Object.entries(totaisSolicitadosPorCategoria).some(([categoria, total]) => total > (categoriasPorLote[categoria]?.quantidade_total || 0)) && (
                <div className="mk-ll__aviso mk-ll__aviso--vermelho">
                  A soma solicitada por categoria ultrapassa o total disponível em pelo menos um grupo.
                </div>
              )}
              {formData.movimentacoes.map((mov, index) => {
              const infoCategoria = categoriasPorLote[mov.categoria];
              const configIcone = iconesConfig.find((ic) =>
              ic.tipo_entidade === 'Lote' &&
              ic.categoria?.toUpperCase() === mov.categoria?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <LancLoteItem key={index} titulo={`Categoria ${index + 1}`} icone={iconeUrl} onRemover={() => handleRemoveMovimentacao(index)} rotuloRemover="Remover categoria">

                    <FL label="Categoria" className="mk-ll__cheio">
                    <B1Select value={(mov.categoria) ?? ""} onChange={(e) => { const v = e.target.value; const cat = categoriasPorLote[v];
                      handleMovimentacaoChange(index, 'categoria', v);
                      handleMovimentacaoChange(index, 'quantidade_maxima', cat.quantidade_total);
                      handleMovimentacaoChange(index, 'peso_medio', cat.peso_medio); }} className={LL_CTL}>
                        {categoriasDisponiveis.map((cat) => {
                        const info = categoriasPorLote[cat];
                        return (
                          <option key={cat} value={cat}>
                              {info.quantidade_total} cb - {cat}
                            </option>);

                      })}
                    </B1Select>
                    </FL>

                    <>
                      <FL label="Quantidade" required>
                        <Input
                        type="number"
                        value={mov.quantidade}
                        onChange={(e) => {
                          const valor = e.target.value;
                          if (valor === '' || parseFloat(valor) <= mov.quantidade_maxima) {
                            handleMovimentacaoChange(index, 'quantidade', valor);
                          }
                        }}
                        max={mov.quantidade_maxima}
                        className={LL_CTL}
                        placeholder="0"
                        required />
                      </FL>
                      <span className="mk-ll__item-rodape self-center">Máximo: {mov.quantidade_maxima} cabeças</span>

                      










                    </>
                  </LancLoteItem>);

            })}

              <LancLoteAdicionar onClick={adicionarMovimentacao} />
            </LancLoteItens>
          }



          <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={loading} textoAcao="Confirmar Movimentação" textoEnviando="Movimentando..." enviando={loading} />
    </LancLoteForm>

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

    <AlertDialog open={mostrarPerguntaConsumo} onOpenChange={setMostrarPerguntaConsumo}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">Existe consumo em aberto</AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            Este lote está com {eventosAbertos.length} consumo(s) em aberto. Deseja fechar o consumo antes de mover?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className="h-8 text-xs"
            onClick={() => {
              setMostrarPerguntaConsumo(false);
              setEtapa('movimentacao');
            }}
          >
            Não fechar
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              setMostrarPerguntaConsumo(false);
              setEtapa('fechamento_consumo');
            }}
          >
            Fechar consumo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={mostrarPerguntaSobraDestino} onOpenChange={setMostrarPerguntaSobraDestino}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">Aproveitar sobra no cocho de destino?</AlertDialogTitle>
          <AlertDialogDescription className="text-xs space-y-2">
            <span className="block">A área de entrada possui cocho(s) com sobra de ciclo fechado. Deseja abrir novo registro em aberto aproveitando esse saldo após salvar a movimentação?</span>
            <span className="block rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
              {sobrasDestinoPendentes.map((item) => `${item.ponto_nome}: ${item.sobra_kg.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`).join(' • ')}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className="h-8 text-xs"
            onClick={() => {
              setSobraDestinoDecidida(true);
              setMostrarPerguntaSobraDestino(false);
              executarMovimentacao(movimentacaoAguardandoSobra || formData, []);
            }}
          >
            Não aproveitar
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              setSobraDestinoDecidida(true);
              setMostrarPerguntaSobraDestino(false);
              executarMovimentacao(movimentacaoAguardandoSobra || formData, sobrasDestinoPendentes);
            }}
          >
            Aproveitar saldo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>);

}