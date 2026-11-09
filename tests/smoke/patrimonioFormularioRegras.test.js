/**
 * D-PROD-157 — regras puras do formulário do bem e mensagens dos erros do
 * Patrimônio, com os corpos que o servidor REALMENTE envia (errorHandler:
 * `field`/`reason` no topo, o resto em `details`).
 *
 *  - correção do cadastro do medidor (A2): enquanto a correção está pendente
 *    (tipo trocado ou leitura inicial mudada num medidor corrigível), a
 *    leitura atual é a própria inicial — a tela não envia o que o servidor
 *    recusa com MEDIDOR_LEITURA_INVALIDA/atual_diferente_da_inicial;
 *  - duplicar não pré-seleciona família, tipo, perfil nem combustível inativos;
 *  - MEDIDOR_LEITURA_INVALIDA por `reason`; PERFIL_UNIDADE_EM_USO com
 *    `details.unidades` (lista); linha dos filhos tirada do `field`
 *    (`medicoes[1].valor`); negação de administrador (ACAO_NAO_PERMITIDA com
 *    `details.exige`).
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
  medicoes: [],
  tanques: [{ id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true, combustiveis: [{ id: 'c1', nome: 'Diesel S10', unidade: 'L', ativo: true }] }],
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
  it('família inativa: sem família e sem tipo', () => {
    const e = estadoInicialDoBem(detalheTrator({ familia: { id: 'f2', nome: 'Máquinas', natureza: 'MAQUINA', ativo: false } }), { duplicar: true });
    expect(e.familia).toBeNull();
    expect(e.tipo).toBeNull();
  });

  it('tipo inativo (família ativa): mantém a família, sem tipo', () => {
    const e = estadoInicialDoBem(detalheTrator({ tipo: { id: 't2', nome: 'Trator de pneus', ativo: false } }), { duplicar: true });
    expect(e.familia).toEqual({ id: 'f2', rotulo: 'Máquinas', natureza: 'MAQUINA' });
    expect(e.tipo).toBeNull();
  });

  it('combustível inativo sai do tanque copiado (marcado e entre as opções)', () => {
    const tanques = [{
      id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
      combustiveis: [{ id: 'c1', nome: 'Diesel S10', unidade: 'L', ativo: true }, { id: 'c9', nome: 'Diesel S500', unidade: 'L', ativo: false }],
    }];
    const copia = estadoInicialDoBem(detalheTrator({ tanques }), { duplicar: true });
    expect(copia.tanques[0].combustivel_ids).toEqual(['c1']);
    expect(copia.tanques[0].combustiveis.map((c) => c.id)).toEqual(['c1']);
    // Na edição do próprio bem o inativo continua legível e vinculado.
    const aberto = estadoInicialDoBem(detalheTrator({ tanques }));
    expect(aberto.tanques[0].combustivel_ids).toEqual(['c1', 'c9']);
  });

  it('medição de perfil inativo não é copiada (nem como principal)', () => {
    const curral = detalheTrator({
      natureza: 'BENFEITORIA',
      familia: { id: 'f1', nome: 'Benfeitorias', natureza: 'BENFEITORIA', ativo: true },
      tipo: { id: 't1', nome: 'Curral', ativo: true },
      medidor: null,
      tanques: [],
      medicoes: [
        { id: 'm1', perfil: { id: 'p1', codigo: 'AREA', nome: 'Área', dimensao: 'AREA', ativo: false }, valor_informado: '1200.0000', unidade_informada: 'm2', principal: true },
        { id: 'm2', perfil: { id: 'p2', codigo: 'CAPACIDADE_ANIMAL', nome: 'Capacidade animal', dimensao: 'CABECAS', ativo: true }, valor_informado: '150.0000', unidade_informada: 'cab', principal: false },
      ],
    });
    const copia = estadoInicialDoBem(curral, { duplicar: true });
    expect(copia.medicoes.map((m) => m.perfil.id)).toEqual(['p2']);
    expect(copia.medicoes.some((m) => m.principal)).toBe(false);
    expect(estadoInicialDoBem(curral).medicoes.map((m) => m.perfil.id)).toEqual(['p1', 'p2']);
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

  it('PERFIL_UNIDADE_EM_USO lê details.unidades (lista)', () => {
    expect(msg({ code: 'PERFIL_UNIDADE_EM_USO', field: 'unidades_permitidas', reason: 'unidade_em_uso', details: { unidades: ['ha'] } })).toMatch(/hectares \(ha\)/);
    const varias = msg({ code: 'PERFIL_UNIDADE_EM_USO', field: 'unidades_permitidas', reason: 'unidade_em_uso', details: { unidades: ['ha', 'm2'] } });
    expect(varias).toMatch(/unidades \(hectares \(ha\), m²\)/);
  });

  it('linha do filho vem do field (medicoes[i] / tanques[i]), que é o que o servidor manda', () => {
    expect(msg({ code: 'MEDICAO_VALOR_INVALIDO', field: 'medicoes[1].valor', reason: 'deve_ser_inteiro' })).toMatch(/\(linha 2\)/);
    expect(msg({ code: 'MEDICAO_VALOR_INVALIDO', field: 'medicoes[1].valor', reason: 'nao_positivo' })).toMatch(/\(linha 2\)/);
    expect(msg({ code: 'MEDICAO_UNIDADE_INCOMPATIVEL', field: 'medicoes[0].unidade', reason: 'unidade_incompativel', details: { unidades_permitidas: ['m2'] } })).toMatch(/\(linha 1\)/);
    expect(msg({ code: 'TANQUE_CAPACIDADE_INVALIDA', field: 'tanques[2].capacidade_litros', reason: 'capacidade_invalida' })).toMatch(/\(linha 3\)/);
    expect(msg({ code: 'TANQUE_COMBUSTIVEL_OBRIGATORIO', field: 'tanques[0].combustivel_ids', reason: 'vazio' })).toMatch(/\(linha 1\)/);
  });

  it('ACAO_NAO_PERMITIDA que exige administrador diz isso; as demais continuam genéricas', () => {
    expect(msg({ code: 'ACAO_NAO_PERMITIDA', details: { exige: ['administrador_ou_is_admin'] } })).toBe('Só o administrador da fazenda pode fazer isso.');
    expect(msg({ code: 'ACAO_NAO_PERMITIDA', details: { tela: 'pat-familias-patrimoniais', acao: 'novo' } }))
      .toBe('Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.');
  });
});
