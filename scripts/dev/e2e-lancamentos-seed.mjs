#!/usr/bin/env node
/**
 * D-PROD-155 — semente do ensaio ponta a ponta REAL da Central Única de
 * Lançamentos (tela real + backend Fastify real + PostgreSQL LOCAL).
 *
 * Cria UM tenant novo por chamada (código e login com sufixo aleatório: nada
 * é apagado, nada colide com execuções anteriores) contendo:
 *   - administrador real da fazenda (`papel_tenant = 'administrador'`, sem
 *     linha de Permissão: o caminho do dono) com senha conhecida;
 *   - empresa COM fuso `America/Sao_Paulo` e SEM perfil financeiro (o
 *     onboarding é feito pela tela);
 *   - parceiros: fornecedor e cliente (papéis explícitos);
 *   - naturezas DESPESA/RECEITA analíticas (e uma sintética, que o seletor
 *     não pode oferecer), centros de custo e de resultado;
 *   - produtos: SAL MINERAL (KG) e RAÇÃO (SACO de 30 kg);
 *   - local "DEPÓSITO 01" e estoque inicial coerente do SAL MINERAL em dois
 *     lotes (3 kg a 10,0000/kg e 10 kg a 12,0000/kg), cada um com o seu
 *     movimento de Entrada, e `estoque_atual = 13`; local "DEPÓSITO 02" vazio
 *     (a compra que o estoque antigo consome entra nele); local "DEPÓSITO 03"
 *     vazio (as compras com desconto/acréscimo da rodada 4 entram nele, para
 *     a venda FIFO consumir o lote descontado e não o da compra do passo 4);
 *   - produto NÚCLEO PROTEICO (SACO de 30 kg), só da prova de representabili-
 *     dade do custo (rodada 4): o ensaio muda o peso do saco dele e devolve;
 *   - SEGUNDA empresa do mesmo tenant ("RETIRO", com fuso e SEM perfil
 *     financeiro) com parceiro e natureza próprios — a troca de empresa na tela
 *     não pode mostrar nada da outra;
 *   - dois usuários comuns (`papel_tenant = 'usuario'`) com linha de
 *     Permissão só na tela `ges-lancamentos-financeiros`: um só com
 *     `visualizar`, outro com `visualizar` + `confirmar` (sem salvar/editar).
 *
 * SÓ roda contra PostgreSQL local (localhost/127.0.0.1) — recusa qualquer
 * outra URL e as variáveis de integração (POSTGRES_PRISMA_URL/POSTGRES_URL).
 *
 * Uso: DATABASE_URL=postgresql://maike_ci:maike_ci@localhost:5432/maike_p3_e2e \
 *        node scripts/dev/e2e-lancamentos-seed.mjs [rotulo]
 * Imprime o JSON da semente (ids e credenciais de TESTE).
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SENHA_E2E = 'senha-e2e-lancamentos-1';

/** Recusa tudo que não for PostgreSQL local. Devolve a URL conferida. */
export const exigirBancoLocal = () => {
  for (const proibida of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (process.env[proibida]) throw new Error(`${proibida} definida: o ensaio só roda contra PostgreSQL local.`);
  }
  const bruta = process.env.DATABASE_URL || '';
  let url;
  try {
    url = new URL(bruta);
  } catch {
    throw new Error('DATABASE_URL ausente ou inválida (ex.: postgresql://maike_ci:maike_ci@localhost:5432/maike_p3_e2e).');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`DATABASE_URL precisa ser PostgreSQL local (recebido host "${url.hostname}").`);
  }
  return bruta;
};

const dia = (s) => new Date(`${s}T00:00:00.000Z`);

/** Linha da tela de Lançamentos com TODAS as ações explícitas (ausente = negado). */
const linhaLancamentos = (acoes) => ({
  modulo_id: 'gestao-rural',
  tela_id: 'ges-lancamentos-financeiros',
  visualizar: true,
  novo: false,
  salvar: false,
  editar: false,
  excluir: false,
  importar: false,
  exportar: false,
  confirmar: false,
  liquidar: false,
  estornar_liquidacao: false,
  cancelar: false,
  ...acoes,
});

/**
 * @param {{ rotulo?: string }} [opcoes]
 */
export const semearTenantE2E = async (opcoes = {}) => {
  exigirBancoLocal();
  const { getPrismaClient } = await import('../../backend/src/database/prismaClient.js');
  const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');
  const { reservarNumero, ESCOPO_TENANT } = await import('../../backend/src/modules/sequencias/entidadeCodigoService.js');
  const prisma = getPrismaClient();

  const sufixo = randomUUID().slice(0, 8);
  const rotulo = String(opcoes.rotulo || 'e2e').replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'e2e';
  const codigo = `e2e-lanc-${rotulo}-${sufixo}`;
  const login = `dono-${rotulo}-${sufixo}`;
  const senhaHash = await gerarSenhaHash(SENHA_E2E);

  return prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({ data: { codigo, nome: `FAZENDA ENSAIO ${rotulo.toUpperCase()}` } });
    const c = cliente.id;
    const usuario = await tx.usuario.create({
      data: { cliente_id: c, nome: 'DONO DA FAZENDA', login, senha_hash: senhaHash, papel_tenant: 'administrador' },
    });
    const empresa = await tx.empresa.create({
      data: { cliente_id: c, numero_empresa: 1, apelido: 'SEDE', nome: 'FAZENDA BOA ESPERANÇA', fuso_horario: 'America/Sao_Paulo' },
    });
    const base = { cliente_id: c, empresa_id: empresa.id };
    const fornecedor = await tx.fornecedor.create({
      data: { ...base, numero_cadastro: '1', tipo_pessoa: 'Jurídica', nome: 'AGROPECUÁRIA BOA VISTA', tipos: ['fornecedor'] },
    });
    const clienteParceiro = await tx.fornecedor.create({
      data: { ...base, numero_cadastro: '2', tipo_pessoa: 'Jurídica', nome: 'FRIGORÍFICO CENTRAL', tipos: ['cliente'] },
    });
    // Naturezas: uma sintética (com filhas) que o seletor NÃO pode oferecer.
    const custeio = await tx.naturezaFinanceira.create({ data: { ...base, numero: '1', tipo: 'DESPESA', nome: 'CUSTEIO' } });
    const insumos = await tx.naturezaFinanceira.create({ data: { ...base, numero: '1.1', tipo: 'DESPESA', nome: 'INSUMOS', pai_id: custeio.id } });
    const frete = await tx.naturezaFinanceira.create({ data: { ...base, numero: '1.2', tipo: 'DESPESA', nome: 'FRETE', pai_id: custeio.id } });
    const vendaInsumos = await tx.naturezaFinanceira.create({ data: { ...base, numero: '2', tipo: 'RECEITA', nome: 'VENDA DE INSUMOS' } });
    const servicos = await tx.naturezaFinanceira.create({ data: { ...base, numero: '3', tipo: 'RECEITA', nome: 'SERVIÇOS PRESTADOS' } });
    const centroCusto = await tx.centroCusto.create({ data: { ...base, numero: '1', nome: 'REBANHO DE CRIA' } });
    const centroResultado = await tx.centroResultado.create({ data: { ...base, numero: '1', nome: 'PECUÁRIA DE CORTE' } });
    const local = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'DEPÓSITO 01' } });
    const sal = await tx.produto.create({
      data: { ...base, numero_produto: '1', nome_produto: 'SAL MINERAL', unidade_principal_estoque: 'KG', unidade_medida: 'KG' },
    });
    const racao = await tx.produto.create({
      data: { ...base, numero_produto: '2', nome_produto: 'RAÇÃO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30', unidade_medida: 'SACO' },
    });

    // Estoque inicial coerente do SAL MINERAL: dois lotes, cada um com a sua Entrada.
    const lotes = [];
    let saldo = 0;
    for (const l of [
      { kg: 3, custo: '10.0000', data: '2026-10-01', doc: 'NF-INICIAL-1' },
      { kg: 10, custo: '12.0000', data: '2026-10-15', doc: 'NF-INICIAL-2' },
    ]) {
      const numero = String(await reservarNumero(tx, { clienteId: c, entidade: 'MovimentacaoEstoque', escopoTipo: ESCOPO_TENANT }));
      const valorTotal = (l.kg * Number(l.custo)).toFixed(4);
      const movimento = await tx.movimentacaoEstoque.create({
        data: {
          ...base,
          numero_movimentacao: numero,
          tipo_movimentacao: 'Entrada',
          tipo_detalhado: 'saldo_inicial',
          data_movimentacao: new Date(`${l.data}T12:00:00.000Z`),
          produto_id: sal.id,
          produto_nome: sal.nome_produto,
          quantidade: String(l.kg),
          unidade_medida: 'KG',
          valor_unitario: l.custo,
          valor_total: valorTotal,
          local_estoque_destino: local.id,
          local_destino: local.nome,
          fornecedor_id: fornecedor.id,
          fornecedor_nome: fornecedor.nome,
          numero_documento: l.doc,
          data_documento: dia(l.data),
          motivo_movimentacao: 'Saldo inicial do ensaio E2E',
          saldo_antes: String(saldo),
          saldo_depois: String(saldo + l.kg),
          usuario_responsavel: login,
          status: 'Ativa',
        },
      });
      saldo += l.kg;
      const lote = await tx.estoqueLoteNota.create({
        data: {
          ...base,
          produto_id: sal.id,
          produto_nome: sal.nome_produto,
          local_estoque_id: local.id,
          local_estoque_nome: local.nome,
          numero_documento: l.doc,
          data_documento: dia(l.data),
          fornecedor_id: fornecedor.id,
          fornecedor_nome: fornecedor.nome,
          custo_unitario: l.custo,
          quantidade_entrada: String(l.kg),
          quantidade_disponivel: String(l.kg),
          movimentacao_entrada_id: movimento.id,
          status: 'Disponivel',
        },
      });
      lotes.push({ id: lote.id, kg: l.kg, custo: l.custo, movimento_id: movimento.id });
    }
    await tx.produto.update({ where: { id: sal.id }, data: { estoque_atual: String(saldo) } });
    const local2 = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '2', nome: 'DEPÓSITO 02' } });
    const local3 = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '3', nome: 'DEPÓSITO 03' } });
    const nucleo = await tx.produto.create({
      data: { ...base, numero_produto: '3', nome_produto: 'NÚCLEO PROTEICO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30', unidade_medida: 'SACO' },
    });

    // Segunda empresa do MESMO tenant: parceiro e natureza só dela, sem perfil.
    const empresa2 = await tx.empresa.create({
      data: { cliente_id: c, numero_empresa: 2, apelido: 'RETIRO', nome: 'FAZENDA RETIRO DO SOL', fuso_horario: 'America/Sao_Paulo' },
    });
    const base2 = { cliente_id: c, empresa_id: empresa2.id };
    const fornecedor2 = await tx.fornecedor.create({
      data: { ...base2, numero_cadastro: '3', tipo_pessoa: 'Jurídica', nome: 'CASA DO PRODUTOR RETIRO', tipos: ['fornecedor'] },
    });
    const manutencao2 = await tx.naturezaFinanceira.create({ data: { ...base2, numero: '9', tipo: 'DESPESA', nome: 'MANUTENÇÃO DO RETIRO' } });

    // Usuários comuns com permissão RESTRITA na tela (vínculo = login).
    const usuarios = {};
    for (const [chave, nome, acoes] of [
      ['vis', 'VAQUEIRO SÓ CONSULTA', {}],
      ['conf', 'GERENTE QUE CONFIRMA', { confirmar: true }],
    ]) {
      const loginRestrito = `${chave}-${rotulo}-${sufixo}`;
      const u = await tx.usuario.create({ data: { cliente_id: c, nome, login: loginRestrito, senha_hash: senhaHash, papel_tenant: 'usuario' } });
      await tx.permissao.create({
        data: {
          cliente_id: c,
          user_email: loginRestrito,
          user_nome: nome,
          is_admin: false,
          modulos_permitidos: ['gestao-rural'],
          mobile_menu_ids: [],
          permissoes_telas: [linhaLancamentos(acoes)],
        },
      });
      usuarios[chave] = { id: u.id, nome, credenciais: { login: loginRestrito, senha: SENHA_E2E } };
    }

    return {
      cliente_id: c,
      usuario_id: usuario.id,
      credenciais: { login, senha: SENHA_E2E },
      usuarios,
      empresa: { id: empresa.id, nome: empresa.nome, apelido: empresa.apelido, fuso: empresa.fuso_horario },
      empresa2: { id: empresa2.id, nome: empresa2.nome, apelido: empresa2.apelido, fuso: empresa2.fuso_horario },
      parceiros2: { fornecedor: { id: fornecedor2.id, nome: fornecedor2.nome } },
      naturezas2: { manutencao: manutencao2.id },
      local2: { id: local2.id, nome: local2.nome },
      local3: { id: local3.id, nome: local3.nome },
      parceiros: { fornecedor: { id: fornecedor.id, nome: fornecedor.nome }, cliente: { id: clienteParceiro.id, nome: clienteParceiro.nome } },
      naturezas: { sintetica: custeio.id, insumos: insumos.id, frete: frete.id, venda_insumos: vendaInsumos.id, servicos: servicos.id },
      centros: { custo: centroCusto.id, resultado: centroResultado.id },
      local: { id: local.id, nome: local.nome },
      produtos: { sal: { id: sal.id, nome: sal.nome_produto }, racao: { id: racao.id, nome: racao.nome_produto }, nucleo: { id: nucleo.id, nome: nucleo.nome_produto } },
      lotes_sal: lotes,
    };
  });
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
  try {
    const s = await semearTenantE2E({ rotulo: process.argv[2] });
    console.log(JSON.stringify(s, null, 2));
  } catch (erro) {
    console.error(`[e2e-seed] ${erro.message}`);
    process.exitCode = 1;
  } finally {
    await closePrismaClient();
  }
}
