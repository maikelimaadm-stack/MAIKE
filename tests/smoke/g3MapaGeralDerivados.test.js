/**
 * G3 — Mapa Geral: regras puras dos dados derivados (src/domain/mapa/mapaGeralDerivados.js)
 * e a marca de "buscar no servidor" do helper de invalidação.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bebedouroDoPonto,
  calcularSituacaoPasto,
  filtrarLotesPorArea,
  filtrarPontosSuplementacaoPorArea,
  filtrarTarefasPorArea,
  filtroDeAreaAtivo,
  statusOcupacaoDaArea,
  statusOcupacaoPorArea,
} from '@/domain/mapa/mapaGeralDerivados';
import { invalidarCachesDoMapa, mapaPrecisaBuscarNoServidor } from '@/components/mapa/invalidarCachesMapa';

describe('id 34/58 — bebedouro do ponto: só por ponto_referencia_id', () => {
  const P1 = { id: 'P1', tipo: 'BEBEDOURO', nome: 'BEB CURRAL', numero_ponto: '1', sigla: 'B1' };
  it('"BEBEDOURO 12" vem antes na lista e contém "1", mas o ponto P1 abre o bebedouro ligado a ele', () => {
    const lista = [
      { id: 'b12', nome: 'BEBEDOURO 12', codigo_interno: 'B10', ponto_referencia_id: 'P12' },
      { id: 'b1', nome: 'BEBEDOURO 1', ponto_referencia_id: 'P1' },
    ];
    expect(bebedouroDoPonto(P1, lista)?.id).toBe('b1');
  });
  it('sem vínculo por id não casa por nome, sigla, número nem coordenada', () => {
    const lista = [
      { id: 'x', nome: 'BEB CURRAL', codigo_interno: 'B1', ponto_referencia_id: 'OUTRO', coordenadas: P1.coordenadas },
      { id: 'y', nome: 'BEB PASTO 1', codigo_interno: '1' },
    ];
    expect(bebedouroDoPonto(P1, lista)).toBeNull();
  });
  it('prefere o ativo quando há mais de um ligado ao ponto', () => {
    const lista = [{ id: 'v', ponto_referencia_id: 'P1', ativo: false }, { id: 'a', ponto_referencia_id: 'P1' }];
    expect(bebedouroDoPonto(P1, lista)?.id).toBe('a');
  });
});

describe('id 56/23 — filtros de área esconderam a área: o que está nela some junto', () => {
  const visiveis = new Set(['a1']);
  const ctxPastagem = { filtroSetor: 'todos', filtroTipoCultura: 'todas', filtroTipoPastagem: ['MOMBACA'] };

  it('tipo de pastagem liga o filtro de área (antes só setor ligava)', () => {
    expect(filtroDeAreaAtivo(ctxPastagem)).toBe(true);
    expect(filtroDeAreaAtivo({ filtroSetor: 'todos', filtroTipoCultura: ['Pastagem'], filtroTipoPastagem: 'todas' })).toBe(true);
    expect(filtroDeAreaAtivo({ filtroSetor: 'todos', filtroTipoCultura: 'todas', filtroTipoPastagem: [] })).toBe(false);
  });

  it('lotes de área escondida saem', () => {
    const lotes = [{ id: 'l1', area_atual_id: 'a1' }, { id: 'l2', area_atual_id: 'a2' }];
    expect(filtrarLotesPorArea(lotes, { filtroAreaAtivo: true, areaIdsFiltrados: visiveis }).map((l) => l.id)).toEqual(['l1']);
    expect(filtrarLotesPorArea(lotes, { filtroAreaAtivo: false, areaIdsFiltrados: visiveis })).toHaveLength(2);
  });

  it('cochos de área escondida saem; depósito (sem área) continua quando só o tipo filtra', () => {
    const pontos = [
      { id: 'c1', categoria_ponto: 'COCHO', area_vinculada_ids: ['a1'] },
      { id: 'c2', categoria_ponto: 'COCHO', area_vinculada_ids: ['a2'] },
      { id: 'd1', categoria_ponto: 'DEPOSITO', area_vinculada_ids: [], setor_id: 's1' },
    ];
    const r = filtrarPontosSuplementacaoPorArea(pontos, { filtroSetor: 'todos', filtroAreaAtivo: true, areaIdsFiltrados: visiveis });
    expect(r.map((p) => p.id)).toEqual(['c1', 'd1']);
  });

  it('filtro de setor: depósito do setor aparece, de outro setor não; antigo sem setor aparece se abastece cocho visível', () => {
    const pontos = [
      { id: 'c1', categoria_ponto: 'COCHO', area_vinculada_ids: ['a1'], deposito_origem_id: 'dAntigo' },
      { id: 'd1', categoria_ponto: 'DEPOSITO', setor_id: 's1' },
      { id: 'd2', categoria_ponto: 'DEPOSITO', setor_id: 's2' },
      { id: 'dAntigo', categoria_ponto: 'DEPOSITO' },
      { id: 'dSolto', categoria_ponto: 'DEPOSITO' },
    ];
    const r = filtrarPontosSuplementacaoPorArea(pontos, { filtroSetor: ['s1'], filtroAreaAtivo: true, areaIdsFiltrados: visiveis });
    expect(r.map((p) => p.id)).toEqual(['c1', 'd1', 'dAntigo']);
  });

  it('tarefas de área escondida saem; setor_nome só vale com filtro de setor', () => {
    const tarefas = [
      { id: 't1', area_id: 'a1' },
      { id: 't2', area_id: 'a2', setor_nome: 'RETIRO 1' },
      { id: 't3', setor_nome: 'RETIRO 1' },
      { id: 't4' },
    ];
    const nomesSetores = new Set(['RETIRO 1']);
    const soPastagem = filtrarTarefasPorArea(tarefas, { ...ctxPastagem, areaIdsFiltrados: visiveis, nomesSetores: new Set() });
    expect(soPastagem.map((t) => t.id)).toEqual(['t1', 't3', 't4']);
    const soSetor = filtrarTarefasPorArea(tarefas, { filtroSetor: ['s1'], filtroTipoCultura: 'todas', filtroTipoPastagem: 'todas', areaIdsFiltrados: visiveis, nomesSetores });
    expect(soSetor.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('ocupação pelos lotes do mapa (69 áreas com lote ativo apareciam "Disponível")', () => {
  it('área gravada "Disponível" com lote ativo dentro não fica Disponível', () => {
    const area = { id: 'a1', status_ocupacao: 'Disponível' };
    expect(statusOcupacaoDaArea(area, [{ quantidade_cabecas: 30 }])).not.toBe('Disponível');
  });
  it('área gravada "Alto" sem lote no mapa fica Disponível', () => {
    expect(statusOcupacaoDaArea({ id: 'a1', status_ocupacao: 'Alto' }, [])).toBe('Disponível');
  });
  it('com capacidade (UA) e peso: faixas de 70% e 110%', () => {
    const area = { id: 'a1', capacidade_maxima: 100 };
    const lote = (cab) => ({ quantidade_cabecas: cab, peso_medio_kg: 450 });
    expect(statusOcupacaoDaArea(area, [lote(50)])).toBe('Médio');
    expect(statusOcupacaoDaArea(area, [lote(100)])).toBe('Alto');
    expect(statusOcupacaoDaArea(area, [lote(150)])).toBe('Sobrepastoreado');
  });
  it('por área, a partir de area_atual_id', () => {
    const m = statusOcupacaoPorArea([{ id: 'a1' }, { id: 'a2' }], [{ area_atual_id: 'a1', quantidade_cabecas: 10 }]);
    expect(m).toEqual({ a1: 'Médio', a2: 'Disponível' });
  });
});

describe('id 57 — situação do pasto', () => {
  const agora = new Date(2026, 10, 16, 10, 0, 0); // 16/11/2026 local
  const areas = [{ id: 'P7' }, { id: 'P3' }];

  it('posição que entrou na fazenda em 01/03 e foi transferida ontem para o PASTO 7: ocupado 1 dia', () => {
    const lotes = [{ id: 'pos-7', area_atual_id: 'P7', data_entrada: '2026-03-01' }];
    const movimentacoes = [{
      tipo: 'Transferência de Área', area_origem_id: 'P3', area_destino_id: 'P7', data_movimentacao: '2026-11-15',
      lote_id: 'entrada-1', lote_ids: ['pos-3', 'pos-7', 'entrada-1'],
      linhas: [{ origem_posicao_id: 'pos-3', destino_posicao_id: 'pos-7', area_origem_id: 'P3' }],
    }];
    const m = calcularSituacaoPasto({ areas, lotes, movimentacoes, agora });
    expect(m.P7).toEqual({ tipo: 'ocupado', dias: 1 });
  });

  it('sem transferência para a área: conta da data_entrada', () => {
    const lotes = [{ id: 'pos-7', area_atual_id: 'P7', data_entrada: '2026-11-06' }];
    expect(calcularSituacaoPasto({ areas, lotes, movimentacoes: [], agora }).P7).toEqual({ tipo: 'ocupado', dias: 10 });
  });

  it('transferência de OUTRO grupo para a mesma área não muda a chegada deste', () => {
    const lotes = [{ id: 'pos-7', area_atual_id: 'P7', data_entrada: '2026-11-06' }];
    const movimentacoes = [{ tipo: 'Transferência de Área', area_destino_id: 'P7', data_movimentacao: '2026-11-15', lote_ids: ['pos-x'], linhas: [{ destino_posicao_id: 'pos-x' }] }];
    expect(calcularSituacaoPasto({ areas, lotes, movimentacoes, agora }).P7.dias).toBe(10);
  });

  it('descanso pela saída mais recente por data, não pela ordem da lista (createdAt desc)', () => {
    const movimentacoes = [
      // lançada hoje com data retroativa: vem primeiro na lista
      { tipo: 'Transferência de Área', area_origem_id: 'P3', area_destino_id: 'P7', data_movimentacao: '2026-09-17' },
      { tipo: 'Transferência de Área', area_origem_id: 'P3', area_destino_id: 'P7', data_movimentacao: '2026-11-11' },
    ];
    const m = calcularSituacaoPasto({ areas, lotes: [], movimentacoes, agora });
    expect(m.P3).toEqual({ tipo: 'descanso', dias: 5 });
    expect(m.P7).toEqual({ tipo: 'vazia', dias: null });
  });
});

describe('invalidarCachesDoMapa marca a próxima leitura de cada chave para ir ao servidor', () => {
  it('uma vez por chave e por invalidação', async () => {
    // estado inicial do módulo pode ter gerações de outros testes: consome
    mapaPrecisaBuscarNoServidor('areas');
    mapaPrecisaBuscarNoServidor('linhas');
    expect(mapaPrecisaBuscarNoServidor('areas')).toBe(false);
    const qc = { invalidateQueries: vi.fn(async () => {}) };
    await invalidarCachesDoMapa(qc, ['areas']);
    expect(mapaPrecisaBuscarNoServidor('areas')).toBe(true);
    expect(mapaPrecisaBuscarNoServidor('areas')).toBe(false);
    // só a chave afetada: linhas não foi tocada por este cadastro
    expect(mapaPrecisaBuscarNoServidor('linhas')).toBe(false);
    const { predicate } = qc.invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: ['mapa-cache', 'areas', 'e', 'default'] })).toBe(true);
    expect(predicate({ queryKey: ['areas', 'e'] })).toBe(true);
    expect(predicate({ queryKey: ['lotes'] })).toBe(false);
  });
});

describe('revisão — a marca de geração vale só para as chaves afetadas', () => {
  const todas = ['areas', 'pontos', 'pontosSuplementacao', 'linhas', 'lotes', 'icones', 'categoriasManejo',
    'eventosSuplementacao', 'leiturasCocho', 'estoqueLotes', 'produtos', 'tarefas', 'movimentacoes'];
  const consumir = () => todas.filter((k) => mapaPrecisaBuscarNoServidor(k));

  it('transferência de depósito força só pontosSuplementacao, estoqueLotes e produtos (não as 13 chaves)', async () => {
    consumir();
    const qc = { invalidateQueries: vi.fn(async () => {}) };
    await invalidarCachesDoMapa(qc, ['estoque-lotes-transferencia', 'saldo-deposito', 'cochos-vinculados-deposito', 'lotes-nota-suplementacao', 'mapa-pontos-supl', 'movimentacoes', 'produtos', 'historico-deposito', 'movimentacoes-deposito-detalhe']);
    expect(consumir().sort()).toEqual(['estoqueLotes', 'pontosSuplementacao', 'produtos']);
  });

  it('sem prefixo do mapa não força nada (só invalida o React Query)', async () => {
    consumir();
    const qc = { invalidateQueries: vi.fn(async () => {}) };
    await invalidarCachesDoMapa(qc);
    await invalidarCachesDoMapa(qc, ['historico-deposito']);
    expect(consumir()).toEqual([]);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('a marca de uma chave não é consumida pela leitura de outra', async () => {
    consumir();
    const qc = { invalidateQueries: vi.fn(async () => {}) };
    await invalidarCachesDoMapa(qc, ['linhas']);
    await invalidarCachesDoMapa(qc, ['areas']);
    expect(consumir().sort()).toEqual(['areas', 'linhas']);
  });
});

describe('revisão — situação do pasto com a posição de destino reaproveitada', () => {
  const agora = new Date(2026, 10, 16, 10, 0, 0);
  const areas = [{ id: 'A' }, { id: 'B' }];
  const T = 'Transferência de Área';
  const ida = (data, area_destino_id, linhas) => ({ tipo: T, data_movimentacao: data, area_destino_id, area_origem_id: linhas[0].area_origem_id, lote_ids: linhas.flatMap((l) => [l.origem_posicao_id, l.destino_posicao_id]), linhas });

  it('parte foi para B e voltou para A (mesma P_A): A segue ocupado desde a primeira chegada (60 dias)', () => {
    const movimentacoes = [
      ida('2026-11-16', 'A', [{ origem_posicao_id: 'P_B', destino_posicao_id: 'P_A', area_origem_id: 'B', quantidade: 40 }]),
      ida('2026-10-27', 'B', [{ origem_posicao_id: 'P_A', destino_posicao_id: 'P_B', area_origem_id: 'A', quantidade: 40 }]),
      ida('2026-09-17', 'A', [{ origem_posicao_id: 'P_X', destino_posicao_id: 'P_A', area_origem_id: 'X', quantidade: 100 }]),
    ];
    const lotes = [{ id: 'P_A', area_atual_id: 'A', quantidade_cabecas: 100, data_entrada: '2026-01-10' }];
    expect(calcularSituacaoPasto({ areas, lotes, movimentacoes, agora }).A).toEqual({ tipo: 'ocupado', dias: 60 });
  });

  it('grupo levado em duas viagens: conta da primeira', () => {
    const movimentacoes = [
      ida('2026-11-06', 'A', [{ origem_posicao_id: 'P_X', destino_posicao_id: 'P_A', area_origem_id: 'X', quantidade: 50 }]),
      ida('2026-11-01', 'A', [{ origem_posicao_id: 'P_X', destino_posicao_id: 'P_A', area_origem_id: 'X', quantidade: 50 }]),
    ];
    const lotes = [{ id: 'P_A', area_atual_id: 'A', quantidade_cabecas: 100, data_entrada: '2026-01-10' }];
    expect(calcularSituacaoPasto({ areas, lotes, movimentacoes, agora }).A.dias).toBe(15);
  });

  it('o pasto esvaziou de todo e o grupo voltou: conta da volta', () => {
    const movimentacoes = [
      ida('2026-11-11', 'A', [{ origem_posicao_id: 'P_B', destino_posicao_id: 'P_A', area_origem_id: 'B', quantidade: 100 }]),
      ida('2026-10-01', 'B', [{ origem_posicao_id: 'P_A', destino_posicao_id: 'P_B', area_origem_id: 'A', quantidade: 100 }]),
      ida('2026-09-17', 'A', [{ origem_posicao_id: 'P_X', destino_posicao_id: 'P_A', area_origem_id: 'X', quantidade: 100 }]),
    ];
    const lotes = [{ id: 'P_A', area_atual_id: 'A', quantidade_cabecas: 100, data_entrada: '2026-01-10' }];
    expect(calcularSituacaoPasto({ areas, lotes, movimentacoes, agora }).A.dias).toBe(5);
  });

  it('posição que nasceu na área (entrada direta) e recebeu reforço: conta da data_entrada', () => {
    const movimentacoes = [
      ida('2026-11-11', 'A', [{ origem_posicao_id: 'P_X', destino_posicao_id: 'P_A', area_origem_id: 'X', quantidade: 20 }]),
    ];
    const lotes = [{ id: 'P_A', area_atual_id: 'A', quantidade_cabecas: 120, data_entrada: '2026-11-01' }];
    expect(calcularSituacaoPasto({ areas, lotes, movimentacoes, agora }).A.dias).toBe(15);
  });
});
