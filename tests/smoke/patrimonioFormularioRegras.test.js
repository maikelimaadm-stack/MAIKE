/**
 * D-PROD-157 — regras puras do formulário do bem e mensagens dos erros do
 * Patrimônio, com os corpos que o servidor REALMENTE envia (errorHandler:
 * `field`/`reason` no topo, o resto em `details`).
 *
 *  - correção do cadastro do medidor (A2): enquanto a correção está pendente
 *    (tipo trocado ou leitura inicial mudada num medidor corrigível), a
 *    leitura atual é a própria inicial — a tela não envia o que o servidor
 *    recusa com MEDIDOR_LEITURA_INVALIDA/atual_diferente_da_inicial;
 *  - duplicar não pré-seleciona tipo inativo (nem de família inativa) e só
 *    copia os Produtos aceitos que ainda servem (ativos, em L, KG ou SACO —
 *    D-PROD-162/163);
 *  - D-PROD-163: o estado tem o "Tipo de bem" (`natureza`) no lugar da
 *    família; a forma do corpo leva `natureza` + `tipo_id`, sem `familia_id`,
 *    `area_id` nem `localizacao_descricao`;
 *  - os tanques vão com `produto_ids` (P-01: `[]` é válido; P-02: até 20);
 *  - MEDIDOR_LEITURA_INVALIDA por `reason`; TANQUE_PRODUTO_INVALIDO por
 *    `reason`, com a linha do tanque tirada do `field`
 *    (`tanques[1].produto_ids`); negação de administrador
 *    (ACAO_NAO_PERMITIDA com `details.exige`).
 */
import { describe, it, expect } from 'vitest';
import { estadoInicialDoBem, formaDoEstado, validarBem } from '@/components/patrimonio/bemFormulario';
import { mensagemErroPatrimonio } from '@/lib/patrimonioErros';

/** Erro como o nativeHttpClient entrega: o corpo do servidor em `cause`. @param {Record<string, unknown>} corpo */
const erroDoServidor = (corpo) => Object.assign(new Error('falha'), { cause: { message: 'texto do servidor', request_id: 'req_1', ...corpo } });

const MEDIDOR_CORRIGIVEL = { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1520.5000', leitura_atual: '1520.5000', data_leitura: '2026-11-01', origem: 'CADASTRO_INICIAL' };
const MEDIDOR_AJUSTADO = { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1300.0000', data_leitura: '2026-11-01', origem: 'AJUSTE_CADASTRO' };

const detalheTrator = (extra = {}) => ({
  id: 'b1', versao: 4, nome: 'Trator TP-02', natureza: 'MAQUINA', propriedade: 'PROPRIO',
  familia: { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', ativo: true },
  tipo: { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', ativo: true },
  medidor: MEDIDOR_CORRIGIVEL,
  tanques: [{
    id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
    produtos: [{ produto_id: 'pd1', nome: 'Diesel S10', codigo_interno: 'DS10', unidade_principal_estoque: 'L', produto_ativo: true }],
  }],
  ...extra,
});

/** Edita o medidor do estado do detalhe e valida como a tela (edição). */
const validarMedidor = (medidorOriginal, mudanca) => {
  const detalhe = detalheTrator({ medidor: medidorOriginal });
  const estado = estadoInicialDoBem(detalhe);
  const e = { ...estado, medidor: { ...estado.medidor, ...mudanca } };
  const ctx = { editando: true, medidorOriginal, hoje: '2026-11-09' };
  return { erros: validarBem(e, ctx), forma: formaDoEstado(e, ctx) };
};

const AVISO_CORRECAO = /correção do cadastro a leitura atual é a própria leitura inicial/;

describe('validarBem — correção do cadastro do medidor (A2)', () => {
  it('leitura inicial corrigida e atual diferente dela (atual digitada antes): erro local na leitura atual', () => {
    const { erros } = validarMedidor(MEDIDOR_CORRIGIVEL, { leitura_atual: '1.600', leitura_inicial: '1.500' });
    expect(erros['medidor.leitura_atual']).toMatch(AVISO_CORRECAO);
  });

  it('leitura inicial corrigida e depois a atual ajustada para cima: erro local na leitura atual', () => {
    const { erros } = validarMedidor(MEDIDOR_CORRIGIVEL, { leitura_inicial: '1.200', leitura_atual: '1.300' });
    expect(erros['medidor.leitura_atual']).toMatch(AVISO_CORRECAO);
  });

  it('tipo trocado num medidor corrigível com a leitura atual alterada: erro local', () => {
    const { erros } = validarMedidor(MEDIDOR_CORRIGIVEL, { tipo: 'ODOMETRO', leitura_atual: '1.600' });
    expect(erros['medidor.leitura_atual']).toMatch(AVISO_CORRECAO);
  });

  it('correção com a atual igual à inicial (comparação numérica, não de texto) passa', () => {
    const { erros, forma } = validarMedidor(MEDIDOR_CORRIGIVEL, { leitura_inicial: '1.500', leitura_atual: '1500' });
    expect(erros).toEqual({});
    expect(forma.medidor).toEqual({ tipo: 'HORIMETRO', leitura_inicial: '1500', leitura_atual: '1500', data_leitura: '2026-11-01' });
  });

  it('ajuste de leitura sem correção (inicial e tipo como estão) continua permitido', () => {
    expect(validarMedidor(MEDIDOR_CORRIGIVEL, { leitura_atual: '1.600', data_leitura: '2026-11-08' }).erros).toEqual({});
    expect(validarMedidor(MEDIDOR_AJUSTADO, { leitura_atual: '1.400', data_leitura: '2026-11-08' }).erros).toEqual({});
  });
});

describe('estadoInicialDoBem — duplicar não pré-seleciona o que está inativo', () => {
  it('família (escondida) inativa: mantém o Tipo de bem, sem tipo', () => {
    const e = estadoInicialDoBem(detalheTrator({ familia: { id: 'f2', nome: 'Máquinas', natureza: 'MAQUINA', ativo: false } }), { duplicar: true });
    expect(e.natureza).toBe('MAQUINA');
    expect(e.tipo).toBeNull();
    expect('familia' in e).toBe(false);
  });

  it('tipo inativo: mantém o Tipo de bem, sem tipo; tipo ativo vem escolhido', () => {
    const e = estadoInicialDoBem(detalheTrator({ tipo: { id: 't2', nome: 'Trator de pneus', ativo: false } }), { duplicar: true });
    expect(e.natureza).toBe('MAQUINA');
    expect(e.tipo).toBeNull();
    expect(estadoInicialDoBem(detalheTrator(), { duplicar: true }).tipo).toEqual({ id: 't2', rotulo: 'Trator de pneus' });
  });

  it('Tipo de bem vem da natureza do detalhe (ou da família, em detalhe antigo); sem nada, vazio', () => {
    expect(estadoInicialDoBem(detalheTrator()).natureza).toBe('MAQUINA');
    expect(estadoInicialDoBem(detalheTrator({ natureza: undefined })).natureza).toBe('MAQUINA');
    expect(estadoInicialDoBem(null).natureza).toBe('');
  });

  it('Produto aceito inativo ou fora de L/KG/SACO sai do tanque copiado (SACO fica, D-PROD-163); no próprio bem continua legível', () => {
    const tanques = [{
      id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
      produtos: [
        { produto_id: 'pd1', nome: 'Diesel S10', codigo_interno: 'DS10', unidade_principal_estoque: 'L', produto_ativo: true },
        { produto_id: 'pd4', nome: 'Arla 32', codigo_interno: null, unidade_principal_estoque: 'KG', produto_ativo: true },
        { produto_id: 'pd9', nome: 'Diesel S500', codigo_interno: null, unidade_principal_estoque: 'L', produto_ativo: false },
        { produto_id: 'pd8', nome: 'Ração ensacada', codigo_interno: null, unidade_principal_estoque: 'SACO', produto_ativo: true },
        { produto_id: 'pd7', nome: 'Graxa avulsa', codigo_interno: null, unidade_principal_estoque: 'UN', produto_ativo: true },
      ],
    }];
    const copia = estadoInicialDoBem(detalheTrator({ tanques }), { duplicar: true });
    expect(copia.tanques[0].produtos).toEqual([
      { id: 'pd1', rotulo: 'Diesel S10', unidade: 'L', ativo: true },
      { id: 'pd4', rotulo: 'Arla 32', unidade: 'KG', ativo: true },
      { id: 'pd8', rotulo: 'Ração ensacada', unidade: 'SACO', ativo: true },
    ]);
    expect(copia.tanques[0].id).toBeNull();
    // Na edição do próprio bem todos continuam (o inativo e o de unidade fora de L/KG/SACO aparecem riscados na tela).
    const aberto = estadoInicialDoBem(detalheTrator({ tanques }));
    expect(aberto.tanques[0].produtos.map((p) => [p.id, p.ativo, p.unidade])).toEqual([
      ['pd1', true, 'L'], ['pd4', true, 'KG'], ['pd9', false, 'L'], ['pd8', true, 'SACO'], ['pd7', true, 'UN'],
    ]);
  });

  it('o estado não tem medições (D-PROD-162), mesmo que um detalhe antigo as traga', () => {
    const e = estadoInicialDoBem(detalheTrator({ medicoes: [{ id: 'm1', perfil: { id: 'p1' }, valor_informado: '1', unidade_informada: 'm2' }] }));
    expect('medicoes' in e).toBe(false);
  });

  it('D-PROD-163: o estado não tem Área nem Localização, mesmo que o detalhe as traga', () => {
    const e = estadoInicialDoBem(detalheTrator({ area: { id: 'a1', nome: 'Retiro Sul' }, localizacao_descricao: 'Galpão' }));
    expect('area' in e).toBe(false);
    expect('localizacao_descricao' in e).toBe(false);
  });
});

describe('validarBem / formaDoEstado — Tipo de bem + tipo, sem família (D-PROD-163)', () => {
  const ctxNovo = { editando: false, medidorOriginal: null, hoje: '2026-11-09' };

  it('sem Tipo de bem: erro "Escolha o tipo de bem" (e o tipo também é cobrado)', () => {
    const e = { ...estadoInicialDoBem(null), nome: 'Bem' };
    const erros = validarBem(e, ctxNovo);
    expect(erros.natureza).toBe('Escolha o tipo de bem');
    expect(erros.tipo).toBe('Escolha o tipo');
    expect('familia' in erros).toBe(false);
  });

  it('a forma do corpo leva natureza + tipo_id, sem familia_id, area_id nem localizacao_descricao', () => {
    const e = estadoInicialDoBem(detalheTrator({ medidor: MEDIDOR_AJUSTADO, area: { id: 'a1', nome: 'Retiro Sul' }, localizacao_descricao: 'Galpão' }));
    const forma = formaDoEstado(e, { editando: true, medidorOriginal: MEDIDOR_AJUSTADO, hoje: '2026-11-09' });
    expect(forma.natureza).toBe('MAQUINA');
    expect(forma.tipo_id).toBe('t2');
    for (const campo of ['familia_id', 'area_id', 'localizacao_descricao']) expect(campo in forma, campo).toBe(false);
  });
});

describe('formaDoEstado / validarBem — tanques com Produtos aceitos (D-PROD-162)', () => {
  const ctx = { editando: true, medidorOriginal: MEDIDOR_AJUSTADO, hoje: '2026-11-09' };

  it('produto_ids na ordem da tela; tanque sem Produto vai com [] e passa na validação (P-01); sem medicoes no corpo', () => {
    const detalhe = detalheTrator({ medidor: MEDIDOR_AJUSTADO });
    const e = estadoInicialDoBem(detalhe);
    const comNovo = { ...e, tanques: [...e.tanques, { chave: 'novo', id: null, identificador: 'Reserva', capacidade: '50', observacao: '', ativo: true, produtos: [] }] };
    expect(validarBem(comNovo, ctx)).toEqual({});
    const forma = formaDoEstado(comNovo, ctx);
    expect(forma.tanques).toEqual([
      { id: 'tq1', identificador: 'Principal', capacidade_litros: '180', produto_ids: ['pd1'], observacao: null, ativo: true },
      { id: undefined, identificador: 'Reserva', capacidade_litros: '50', produto_ids: [], observacao: null, ativo: true },
    ]);
    expect('medicoes' in forma).toBe(false);
  });

  it('mais de 20 Produtos no tanque é erro local na linha (P-02)', () => {
    const e = estadoInicialDoBem(detalheTrator({ medidor: MEDIDOR_AJUSTADO }));
    const produtos = Array.from({ length: 21 }, (_, i) => ({ id: `pd-${i}`, rotulo: `P${i}`, unidade: 'L', ativo: true }));
    const erros = validarBem({ ...e, tanques: [{ ...e.tanques[0], produtos }] }, ctx);
    expect(erros['tanques.0.produtos']).toBe('No máximo 20 Produtos aceitos por tanque');
  });
});

describe('mensagemErroPatrimonio — corpos reais do servidor', () => {
  const msg = (corpo) => mensagemErroPatrimonio(erroDoServidor(corpo), 'falhou');

  it('MEDIDOR_LEITURA_INVALIDA segue a reason', () => {
    expect(msg({ code: 'MEDIDOR_LEITURA_INVALIDA', field: 'medidor.leitura_atual', reason: 'atual_diferente_da_inicial' }))
      .toMatch(/correção do cadastro do medidor a leitura atual é a própria leitura inicial.*Nada foi gravado\.$/);
    expect(msg({ code: 'MEDIDOR_LEITURA_INVALIDA', field: 'medidor.data_leitura', reason: 'obrigatoria' })).toBe('Informe a leitura e a data da leitura do medidor. Nada foi gravado.');
    expect(msg({ code: 'MEDIDOR_LEITURA_INVALIDA', field: 'medidor.leitura_inicial', reason: 'sem_medidor' })).toBe('"Sem medidor" não tem leitura nem data. Nada foi gravado.');
    expect(msg({ code: 'MEDIDOR_LEITURA_INVALIDA', field: 'medidor.leitura_inicial', reason: 'formato' })).toBe('Leitura do medidor inválida: informe um número maior ou igual a zero. Nada foi gravado.');
  });

  it('TANQUE_PRODUTO_INVALIDO segue a reason e tira a linha do tanque do field (tanques[i].produto_ids)', () => {
    expect(msg({ code: 'TANQUE_PRODUTO_INVALIDO', field: 'tanques[1].produto_ids', reason: 'outra_empresa', details: { produto_id: 'pd1' } })).toMatch(/\(linha 2\).*outra fazenda/);
    expect(msg({ code: 'TANQUE_PRODUTO_INVALIDO', field: 'tanques[0].produto_ids', reason: 'inativo', details: { produto_id: 'pd1' } })).toMatch(/\(linha 1\).*inativo/);
    expect(msg({ code: 'TANQUE_PRODUTO_INVALIDO', field: 'tanques[0].produto_ids', reason: 'unidade_incompativel', details: { produto_id: 'pd8', unidade: 'UN' } })).toMatch(/em UN/);
    expect(msg({ code: 'TANQUE_PRODUTO_INVALIDO', field: 'tanques[0].produto_ids', reason: 'limite', details: { maximo: 20 } })).toMatch(/no máximo 20 Produtos/);
    expect(msg({ code: 'TANQUE_PRODUTO_INVALIDO', field: 'tanques[2].produto_ids', reason: 'inexistente', details: { produto_id: 'x' } })).toMatch(/\(linha 3\).*não existe nesta fazenda/);
  });

  it('linha do filho vem do field (tanques[i]), que é o que o servidor manda', () => {
    expect(msg({ code: 'TANQUE_CAPACIDADE_INVALIDA', field: 'tanques[2].capacidade_litros', reason: 'capacidade_invalida' })).toMatch(/\(linha 3\)/);
  });

  it('ACAO_NAO_PERMITIDA que exige administrador diz isso; as demais continuam genéricas', () => {
    expect(msg({ code: 'ACAO_NAO_PERMITIDA', details: { exige: ['administrador_ou_is_admin'] } })).toBe('Só o administrador da fazenda pode fazer isso.');
    expect(msg({ code: 'ACAO_NAO_PERMITIDA', details: { tela: 'pat-familias-patrimoniais', acao: 'novo' } }))
      .toBe('Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.');
  });
});
