/**
 * D-PROD-162 — porta e API do Patrimônio depois da simplificação, e as
 * mensagens novas de `patrimonioErros`.
 *
 *  - catálogos: só famílias e tipos; o `codigo` é opcional no POST (gerado no
 *    servidor a partir do nome, P-05); o catálogo padrão conta só famílias e tipos;
 *  - opções do bem: `produtos` (Produtos que um tanque aceita) pede a empresa e
 *    aceita o filtro `unidade` (`L` | `KG`); perfis e combustíveis saíram;
 *  - abastecimento: `quantidade` na unidade do Produto; sem `tipo_combustivel_id`,
 *    `quantidade_litros` nem `conversao_*` (corpo antigo falha ANTES da rede);
 *    opções sem `tipos`/`produtos`; os fatores kg/L saíram da API;
 *  - erros novos (Produtos aceitos, Produto no tanque, unidade de estoque) e os
 *    antigos de perfis, medições, combustíveis e fator sem texto próprio.
 * Mock só da borda: `fetch` (backend falso).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

let backend;

/** Carrega os módulos depois do `resetModules` (o cliente HTTP lê o ambiente). */
const carregar = async () => ({
  api: await import('@/apis/patrimonio'),
  porta: await import('@/apis/patrimonio/patrimonioNativePort.js'),
  erros: await import('@/lib/patrimonioErros'),
  dominio: await import('@/lib/patrimonioDominio'),
});

/** Erro como o nativeHttpClient entrega: o corpo do servidor em `cause`. */
const erroDoServidor = (corpo) => Object.assign(new Error('falha'), { cause: { message: 'texto do servidor', request_id: 'req_1', ...corpo } });

const PREVIA = Object.freeze({
  empresa_id: 'emp-1',
  bem_id: 'b1',
  tanque_id: 'tq1',
  produto_id: 'p1',
  local_estoque_id: 'l1',
  data_operacional: '2026-11-08',
  quantidade: '120.5000',
  medidor_leitura: '1300.5',
  tanque_cheio: true,
});

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  localStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  backend = instalarBackendFake(({ method, path }) => {
    if (method === 'POST' && path === '/patrimonio-familias') return { status: 201, body: { id: 'f1', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', versao: 1 } };
    if (method === 'POST' && path === '/patrimonio-tipos') return { status: 201, body: { id: 't1', codigo: 'TRATOR', nome: 'Trator', versao: 1 } };
    if (method === 'POST' && path === '/patrimonio-catalogo-padrao') {
      return {
        status: 200,
        body: {
          criados: { familias: 6, tipos: 14, perfis: 9, combustiveis: 4 },
          existentes: { familias: 0, tipos: 1 },
          conflitos: [{ recurso: 'tipos', codigo: 'TRATOR', motivo: 'nome_em_uso', extra: 'x' }],
        },
      };
    }
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/produtos') {
      return { status: 200, body: { itens: [{ id: 'p1', nome: 'Diesel S10 (L)', codigo_interno: 'DS10', unidade_principal_estoque: 'L' }], has_more: false, next_cursor: null } };
    }
    if (method === 'POST' && path === '/patrimonio-abastecimentos-previa') return { status: 200, body: { plano: { quantidade: '120.5000', unidade: 'L' }, bloqueios: [] } };
    if (method === 'POST' && path === '/patrimonio-abastecimentos') return { status: 201, body: { id: 'a1', quantidade: '120.5000', unidade: 'L' } };
    return undefined;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('API-1 — catálogos: só famílias e tipos; código opcional', () => {
  it('CAMINHOS_CATALOGO tem só famílias e tipos; perfis e combustíveis são recurso inválido (falha antes da rede)', async () => {
    const { api, porta } = await carregar();
    expect(Object.keys(porta.CAMINHOS_CATALOGO)).toEqual(['familias', 'tipos']);
    for (const recurso of ['perfis-medicao', 'combustiveis']) {
      await expect(api.listPatrimonioCatalogoPage(recurso, {}), recurso).rejects.toBeTruthy();
      await expect(api.createPatrimonioCatalogo(recurso, { codigo: 'X1', nome: 'X' }), recurso).rejects.toBeTruthy();
    }
    expect(backend.chamadas).toEqual([]);
  });

  it('POST de família e de tipo SEM código (o servidor gera do nome, P-05); com código também vai', async () => {
    const { api } = await carregar();
    await api.createPatrimonioCatalogo('familias', { nome: 'Máquinas', natureza: 'MAQUINA' });
    await api.createPatrimonioCatalogo('tipos', { familia_id: 'f1', nome: 'Trator' });
    await api.createPatrimonioCatalogo('familias', { codigo: 'VEICULOS', nome: 'Veículos', natureza: 'VEICULO' });
    expect(backend.chamadas.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'POST', path: '/patrimonio-familias', body: { nome: 'Máquinas', natureza: 'MAQUINA' } },
      { method: 'POST', path: '/patrimonio-tipos', body: { familia_id: 'f1', nome: 'Trator' } },
      { method: 'POST', path: '/patrimonio-familias', body: { codigo: 'VEICULOS', nome: 'Veículos', natureza: 'VEICULO' } },
    ]);
  });

  it('POST sem nome, com código vazio, com empresa_id ou com perfis falha antes da rede', async () => {
    const { api } = await carregar();
    await expect(api.createPatrimonioCatalogo('familias', { natureza: 'MAQUINA' })).rejects.toBeTruthy();
    await expect(api.createPatrimonioCatalogo('familias', { codigo: '', nome: 'Máquinas', natureza: 'MAQUINA' })).rejects.toBeTruthy();
    await expect(api.createPatrimonioCatalogo('familias', { nome: 'Máquinas', natureza: 'MAQUINA', empresa_id: 'emp-1' })).rejects.toBeTruthy();
    await expect(api.createPatrimonioCatalogo('tipos', { familia_id: 'f1', nome: 'Curral', perfis: [] })).rejects.toBeTruthy();
    expect(backend.chamadas).toEqual([]);
  });

  it('catálogo padrão: contagens só de famílias e tipos; conflitos só com recurso, código e motivo', async () => {
    const { api } = await carregar();
    expect(await api.instalarPatrimonioCatalogoPadrao()).toEqual({
      criados: { familias: 6, tipos: 14 },
      existentes: { familias: 0, tipos: 1 },
      conflitos: [{ recurso: 'tipos', codigo: 'TRATOR', motivo: 'nome_em_uso' }],
    });
  });
});

describe('API-2 — opções do bem: Produtos que o tanque aceita', () => {
  it('RECURSOS_OPCOES_PATRIMONIO troca perfis/combustíveis por produtos; produtos pede a empresa', async () => {
    const { api } = await carregar();
    expect([...api.RECURSOS_OPCOES_PATRIMONIO]).toEqual(['familias', 'tipos', 'produtos', 'responsaveis', 'parceiros', 'centros-custo', 'areas']);
    expect(api.RECURSOS_OPCOES_DA_EMPRESA).toContain('produtos');
    await expect(api.listOpcoesBemPatrimonial('produtos', {})).rejects.toBeTruthy();
    for (const recurso of ['perfis-medicao', 'combustiveis']) await expect(api.listOpcoesBemPatrimonial(recurso, {}), recurso).rejects.toBeTruthy();
    expect(backend.chamadas).toEqual([]);
  });

  it('GET /bens-patrimoniais-opcoes/produtos com empresa, busca, unidade e página; envelope de opções', async () => {
    const { api } = await carregar();
    const pagina = await api.listOpcoesBemPatrimonial('produtos', { empresa_id: 'emp-1', q: ' die ', unidade: 'L', limit: 20, cursor: 'c1' });
    expect(pagina).toEqual({ itens: [{ id: 'p1', nome: 'Diesel S10 (L)', codigo_interno: 'DS10', unidade_principal_estoque: 'L' }], has_more: false, next_cursor: null });
    expect(backend.chamadas).toHaveLength(1);
    expect(backend.chamadas[0]).toMatchObject({ method: 'GET', path: '/bens-patrimoniais-opcoes/produtos', query: { empresa_id: 'emp-1', q: 'die', unidade: 'L', limit: '20', cursor: 'c1' } });
    // Sem `unidade`: L e KG (o servidor decide); unidade fora de L/KG falha antes da rede.
    await api.listOpcoesBemPatrimonial('produtos', { empresa_id: 'emp-1' });
    expect(backend.chamadas[1].query).toEqual({ empresa_id: 'emp-1' });
    await expect(api.listOpcoesBemPatrimonial('produtos', { empresa_id: 'emp-1', unidade: 'SACO' })).rejects.toBeTruthy();
    expect(backend.chamadas).toHaveLength(2);
  });

  it('a porta só monta `unidade` nas opções de produtos (famílias e tipos não levam o filtro)', async () => {
    const { porta } = await carregar();
    expect(porta.montarCaminhoOpcoes('produtos', { empresa_id: 'emp-1', unidade: 'KG' })).toBe('/bens-patrimoniais-opcoes/produtos?empresa_id=emp-1&unidade=KG');
    expect(porta.montarCaminhoOpcoes('familias', { unidade: 'KG', q: 'maq' })).toBe('/bens-patrimoniais-opcoes/familias?q=maq');
  });

  it('saíram da API: produtos elegíveis do bem, vínculos combustível × produto e fatores kg/L', async () => {
    const { api, porta } = await carregar();
    for (const nome of [
      'listProdutosElegiveisBemPatrimonial',
      'listProdutosDoCombustivelPage',
      'createVinculoCombustivelProduto',
      'updateVinculoCombustivelProduto',
      'listOpcoesProdutosCombustivel',
      'listConversoesCombustivelPage',
      'createConversaoCombustivel',
      'encerrarConversaoCombustivel',
    ]) {
      expect(nome in api, nome).toBe(false);
    }
    for (const nome of ['montarCaminhoProdutosDoCombustivel', 'montarCaminhoOpcoesProdutosCombustivel', 'montarCaminhoProdutosElegiveisDoBem', 'montarCaminhoConversoes']) {
      expect(nome in porta, nome).toBe(false);
    }
    const operacoes = Object.keys(porta.operacoesNativas);
    expect(operacoes.filter((op) => /combustivel|conversao|elegiveis/i.test(op))).toEqual([]);
  });
});

describe('API-3 — abastecimento em quantidade da unidade do Produto', () => {
  it('RECURSOS_OPCOES_ABASTECIMENTO sem tipos nem produtos-por-tipo; todos pedem a empresa', async () => {
    const { api } = await carregar();
    expect([...api.RECURSOS_OPCOES_ABASTECIMENTO]).toEqual(['bens', 'tanques', 'produtos-filtro', 'locais', 'produtos-do-bem']);
    for (const recurso of ['tipos', 'produtos']) await expect(api.listOpcoesAbastecimento(recurso, { empresa_id: 'emp-1' }), recurso).rejects.toBeTruthy();
    await expect(api.listOpcoesAbastecimento('bens', {})).rejects.toBeTruthy();
    expect(backend.chamadas).toEqual([]);
  });

  it('prévia com `quantidade` (4 casas, texto) vai com o corpo exato', async () => {
    const { api } = await carregar();
    const r = await api.previaAbastecimento({ ...PREVIA });
    expect(r).toEqual({ plano: { quantidade: '120.5000', unidade: 'L' }, bloqueios: [] });
    expect(backend.chamadas).toHaveLength(1);
    expect(backend.chamadas[0]).toMatchObject({ method: 'POST', path: '/patrimonio-abastecimentos-previa', body: { ...PREVIA } });
  });

  it('prévia com campo antigo, sem quantidade ou com 5 casas falha antes da rede', async () => {
    const { api } = await carregar();
    const { quantidade: _q, ...semQuantidade } = PREVIA;
    for (const [nome, corpo] of [
      ['quantidade_litros', { ...semQuantidade, quantidade_litros: '120' }],
      ['tipo_combustivel_id', { ...PREVIA, tipo_combustivel_id: 'c1' }],
      ['sem quantidade', semQuantidade],
      ['5 casas', { ...PREVIA, quantidade: '1.23456' }],
      ['número', { ...PREVIA, quantidade: 120 }],
    ]) {
      await expect(api.previaAbastecimento(corpo), nome).rejects.toBeTruthy();
    }
    expect(backend.chamadas).toEqual([]);
  });

  it('confirmação: prévia + tanque_cheio + operation_id; `conversao_*` falha antes da rede', async () => {
    const { api } = await carregar();
    // Corpo EXATO (todas as chaves, como `montarCorpoConfirmacao` manda).
    const corpo = { ...PREVIA, observacao: null, referencia_externa: null, operation_id: 'abast-0001-xyz' };
    await api.confirmarAbastecimento(corpo);
    expect(backend.chamadas).toHaveLength(1);
    expect(backend.chamadas[0]).toMatchObject({ method: 'POST', path: '/patrimonio-abastecimentos', body: corpo });
    await expect(api.confirmarAbastecimento({ ...corpo, conversao_id: 'cv1', conversao_versao: 1 })).rejects.toBeTruthy();
    const { tanque_cheio: _t, ...semTanqueCheio } = corpo;
    await expect(api.confirmarAbastecimento(semTanqueCheio)).rejects.toBeTruthy();
    expect(backend.chamadas).toHaveLength(1);
  });
});

describe('ERR-1 — mensagens novas (D-PROD-162)', () => {
  it('TANQUE_PRODUTO_INVALIDO segue a reason e aponta a linha do tanque', async () => {
    const { erros } = await carregar();
    const msg = (reason, details = {}) =>
      erros.mensagemErroPatrimonio(erroDoServidor({ code: 'TANQUE_PRODUTO_INVALIDO', field: 'tanques[1].produto_ids', reason, details: { field: 'tanques[1].produto_ids', ...details } }), 'falhou');
    expect(msg('inexistente')).toBe('Um Produto aceito do tanque (linha 2) não existe nesta fazenda (ou não está mais disponível). Retire-o e escolha outro. Nada foi gravado.');
    expect(msg('outra_empresa')).toBe('Um Produto aceito do tanque (linha 2) é de outra fazenda: só Produtos desta fazenda podem ser aceitos. Nada foi gravado.');
    expect(msg('inativo')).toBe('Um Produto aceito do tanque (linha 2) está inativo: só Produtos ativos podem ser acrescentados. Nada foi gravado.');
    expect(msg('unidade_incompativel', { unidade: 'SACO' })).toBe('Um Produto aceito do tanque (linha 2) tem estoque em SACO: o tanque só aceita Produto em litros (L) ou em quilos (KG). Nada foi gravado.');
    expect(msg('repetido')).toBe('O mesmo Produto aparece mais de uma vez nos Produtos aceitos do tanque (linha 2). Nada foi gravado.');
    expect(msg('limite', { maximo: 20 })).toBe('Um tanque aceita no máximo 20 Produtos ativos (linha 2). Nada foi gravado.');
  });

  it('abastecimento: Produto recusado, Produto não aceito pelo tanque, unidade e capacidade', async () => {
    const { erros } = await carregar();
    const msg = (code, reason, details = {}) => erros.mensagemErroAbastecimento(erroDoServidor({ code, field: 'produto_id', reason, details }), 'falhou');
    expect(msg('ABASTECIMENTO_PRODUTO_INVALIDO', 'inexistente')).toBe('O Produto não existe nesta fazenda. Nada foi gravado.');
    expect(msg('ABASTECIMENTO_PRODUTO_INVALIDO', 'outra_empresa')).toBe('O Produto é de outra fazenda. Nada foi gravado.');
    expect(msg('ABASTECIMENTO_PRODUTO_INVALIDO', 'inativo')).toBe('O Produto está inativo. Nada foi gravado.');
    expect(msg('ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'nao_aceito_pelo_tanque')).toBe(
      'O tanque escolhido não aceita este Produto. Marque o Produto nos Produtos aceitos do tanque em Bens Patrimoniais. Nada foi gravado.',
    );
    expect(msg('ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'unidade_nao_aceita', { unidade: 'SACO' })).toBe(
      'O estoque deste Produto está em SACO, não em litros (L) nem em quilos (KG): ele não pode ser abastecido. Nada foi gravado.',
    );
    expect(msg('ABASTECIMENTO_EXCEDE_CAPACIDADE', 'excede_capacidade_tanque', { capacidade_litros: '180.0000' })).toBe(
      'A quantidade em litros passa da capacidade nominal do tanque (180 L). Nada foi gravado.',
    );
    expect(erros.mensagemErroAbastecimento(erroDoServidor({ code: 'OPERACAO_VALORES_INVALIDOS', field: 'quantidade', reason: 'quantidade_nao_positiva' }), 'x')).toBe(
      'Informe uma quantidade maior que zero. Nada foi gravado.',
    );
  });

  it('saldo insuficiente diz a unidade do Produto (L ou kg) quando o servidor a informa', async () => {
    const { erros } = await carregar();
    const msg = (details) => erros.mensagemErroAbastecimento(erroDoServidor({ code: 'ESTOQUE_SALDO_INSUFICIENTE', reason: 'saldo_lote_insuficiente', details }), 'x');
    expect(msg({ disponivel: '100.0000', solicitado: '120.0000', unidade: 'L' })).toBe('Saldo insuficiente deste Produto neste local: disponível 100 L, pedido 120 L. Nada foi gravado.');
    expect(msg({ disponivel: '80.5000', solicitado: '90.0000', unidade: 'KG' })).toBe('Saldo insuficiente deste Produto neste local: disponível 80,5 kg, pedido 90 kg. Nada foi gravado.');
    expect(msg({ disponivel: '1.0000', solicitado: '2.0000' })).toBe('Saldo insuficiente deste Produto neste local: disponível 1, pedido 2. Nada foi gravado.');
  });

  it('cancelamento bloqueado por unidade_mudou; bloqueio da prévia sem "Nada foi gravado."', async () => {
    const { erros } = await carregar();
    expect(erros.mensagemErroAbastecimento(erroDoServidor({ code: 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', reason: 'unidade_mudou' }), 'x')).toBe(
      'O estorno exato não é seguro agora (a unidade de estoque do Produto mudou desde o abastecimento). Nada foi alterado.',
    );
    expect(erros.mensagemDoBloqueioAbastecimento({ code: 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', field: 'produto_id', reason: 'nao_aceito_pelo_tanque', details: {} })).toBe(
      'O tanque escolhido não aceita este Produto. Marque o Produto nos Produtos aceitos do tanque em Bens Patrimoniais.',
    );
  });

  it('Produto: no tanque do Patrimônio não muda de fazenda; unidade de estoque em uso por reason', async () => {
    const { erros } = await carregar();
    const msg = (corpo) => erros.mensagemErroPatrimonio(erroDoServidor(corpo), 'x');
    expect(
      msg({
        code: 'PRODUTO_EM_TANQUE_PATRIMONIO',
        details: { tanques: [{ bem_id: 'b1', bem_numero: '7', tanque_id: 'tq1', identificador: 'Principal' }, { bem_id: 'b2', bem_numero: '9', tanque_id: 'tq2', identificador: 'Reserva' }] },
      }),
    ).toBe(
      'Este Produto é aceito em tanque de bem do Patrimônio (bem 7, tanque Principal; bem 9, tanque Reserva): ele não muda de fazenda. Tire-o dos Produtos aceitos do tanque em Bens Patrimoniais antes. Nada foi gravado.',
    );
    expect(msg({ code: 'PRODUTO_EM_TANQUE_PATRIMONIO', details: {} })).toBe(
      'Este Produto é aceito em tanque de bem do Patrimônio: ele não muda de fazenda. Tire-o dos Produtos aceitos do tanque em Bens Patrimoniais antes. Nada foi gravado.',
    );
    const unidade = (reason) => msg({ code: 'PRODUTO_UNIDADE_EM_USO', reason, details: { reason, de: 'KG', para: 'L' } });
    for (const reason of ['estoque', 'lotes', 'movimentos', 'lancamentos']) {
      expect(unidade(reason), reason).toMatch(/^Este Produto já tem .+: a unidade de estoque não muda \(KG → L\)\. Cadastre um Produto novo em litros, ex\.: “Diesel S10 \(L\)”\. Nada foi gravado\.$/);
    }
    expect(unidade('estoque')).toContain('já tem estoque');
    expect(unidade('lotes')).toContain('já tem lotes');
    expect(unidade('movimentos')).toContain('já tem movimentos de estoque');
    expect(unidade('lancamentos')).toContain('já tem itens em lançamentos');
    expect(msg({ code: 'PRODUTO_UNIDADE_EM_USO', reason: 'aceito_em_tanque', details: { reason: 'aceito_em_tanque', de: 'KG', para: 'SACO' } })).toBe(
      'Este Produto é aceito em tanque de bem do Patrimônio: a unidade de estoque só pode ser L ou KG enquanto ele estiver aceito. Tire-o dos Produtos aceitos do tanque antes. Nada foi gravado.',
    );
  });

  it('códigos que saíram (perfis, medições, combustíveis, vínculo, fator) não têm texto próprio: caem no genérico', async () => {
    const { erros } = await carregar();
    const generico = erros.mensagemErroPatrimonio(erroDoServidor({ code: 'CODIGO_QUE_NAO_EXISTE' }), 'falhou');
    for (const code of [
      'PERFIL_MEDICAO_NAO_ENCONTRADO', 'COMBUSTIVEL_NAO_ENCONTRADO', 'TIPO_PERFIS_NAO_APLICAVEIS', 'TIPO_PERFIS_INVALIDOS', 'PERFIL_UNIDADE_EM_USO',
      'PERFIL_UNIDADES_INVALIDAS', 'MEDICAO_UNIDADE_INCOMPATIVEL', 'MEDICAO_PERFIL_DUPLICADO', 'MEDICAO_PRINCIPAL_DUPLICADA', 'MEDICAO_VALOR_INVALIDO',
      'MEDICAO_LIMITE_EXCEDIDO', 'TANQUE_COMBUSTIVEL_OBRIGATORIO', 'TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'COMBUSTIVEL_PRODUTO_INVALIDO',
      'COMBUSTIVEL_PRODUTO_DUPLICADO', 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', 'COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO', 'PRODUTO_VINCULADO_COMBUSTIVEL',
    ]) {
      expect(erros.mensagemErroPatrimonio(erroDoServidor({ code }), 'falhou'), code).toBe(generico);
    }
    const genericoAbast = erros.mensagemErroAbastecimento(erroDoServidor({ code: 'CODIGO_QUE_NAO_EXISTE' }), 'falhou');
    for (const code of ['ABASTECIMENTO_CONVERSAO_AUSENTE', 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'ABASTECIMENTO_CONVERSAO_INVALIDA', 'CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA', 'COMBUSTIVEL_PRODUTO_INVALIDO', 'TANQUE_COMBUSTIVEL_INCOMPATIVEL']) {
      expect(erros.mensagemErroAbastecimento(erroDoServidor({ code }), 'falhou'), code).toBe(genericoAbast);
    }
    expect('mensagemErroConversao' in erros).toBe(false);
    // "Não encontrado" só para o que ainda existe.
    expect(erros.ehNaoEncontradoPatrimonio(erroDoServidor({ code: 'FAMILIA_PATRIMONIAL_NAO_ENCONTRADA' }))).toBe(true);
    for (const code of ['PERFIL_MEDICAO_NAO_ENCONTRADO', 'COMBUSTIVEL_NAO_ENCONTRADO', 'CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA']) {
      expect(erros.ehNaoEncontradoPatrimonio(erroDoServidor({ code })), code).toBe(false);
    }
  });

  it('rótulos de campo: Produtos aceitos e Quantidade; o código gerado do catálogo pede outro nome', async () => {
    const { erros } = await carregar();
    expect(erros.mensagemErroPatrimonio(erroDoServidor({ code: 'REQUEST_VALIDATION_FAILED', field: 'tanques[0].produto_ids' }), 'x')).toBe(
      'Dados inválidos no campo "Produtos aceitos". Revise e tente novamente.',
    );
    expect(erros.mensagemErroAbastecimento(erroDoServidor({ code: 'REQUEST_VALIDATION_FAILED', field: 'quantidade' }), 'x')).toBe(
      'Dados inválidos no campo "Quantidade". Revise e tente novamente.',
    );
    expect(erros.mensagemErroPatrimonio(erroDoServidor({ code: 'PATRIMONIO_CODIGO_DUPLICADO', field: 'codigo' }), 'x')).toBe(
      'Já existe um cadastro com este código. Use outro nome (o código é gerado a partir dele) ou outro código. Nada foi gravado.',
    );
  });
});

describe('DOM-1 — domínio do front sem medições, perfis e combustíveis', () => {
  it('saem dimensões, unidades físicas, finalidades e unidades de combustível; entra o rótulo da unidade de estoque', async () => {
    const { dominio } = await carregar();
    for (const nome of [
      'DIMENSOES', 'ROTULO_DIMENSAO', 'UNIDADES_DA_DIMENSAO', 'UNIDADE_CANONICA', 'DIMENSOES_INTEIRAS', 'ROTULO_UNIDADE', 'SIMBOLO_UNIDADE',
      'unidadesDaDimensao', 'unidadeCanonicaDa', 'rotuloDaUnidade', 'FINALIDADES_PERFIL', 'ROTULO_FINALIDADE', 'UNIDADES_COMBUSTIVEL', 'ROTULO_UNIDADE_COMBUSTIVEL',
    ]) {
      expect(nome in dominio, nome).toBe(false);
    }
    expect(dominio.ROTULO_UNIDADE_ESTOQUE).toEqual({ L: 'L', KG: 'kg' });
    for (const natureza of dominio.NATUREZAS_PATRIMONIO) {
      expect('medicoes' in dominio.CAPACIDADES_DA_NATUREZA[natureza], natureza).toBe(false);
    }
    expect(Object.keys(dominio.CAMPOS_DA_CAPACIDADE)).not.toContain('medicoes');
    // A matriz que fica é a de hoje (tanques só em Máquina, Veículo e Equipamento).
    expect(dominio.NATUREZAS_PATRIMONIO.filter((n) => dominio.CAPACIDADES_DA_NATUREZA[n].tanques)).toEqual(['MAQUINA', 'VEICULO', 'EQUIPAMENTO']);
  });
});
