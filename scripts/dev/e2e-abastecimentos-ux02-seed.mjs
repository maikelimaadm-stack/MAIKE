#!/usr/bin/env node
/**
 * D-PROD-160 (MAIKE-PATRIMONIO-UX-02) — semente do ensaio E2E-2 do ACEITE
 * HUMANO: "a pessoa cadastra Diesel S10 escolhendo ali o Produto da fazenda; no
 * bem permite Diesel S10; ao abastecer escolhe só o Produto; a troca do
 * Produto associado (A → B) acontece no cadastro de Combustíveis e vale no
 * próximo abastecimento, sem tocar na máquina e sem reescrever o histórico".
 * Molde: `e2e-abastecimentos-seed.mjs` (D-PROD-159) — NÃO é importado dele
 * (outro roteiro o mantém); só a guarda de banco local é reaproveitada.
 *
 * UM tenant novo por chamada (sufixo aleatório: nada é apagado nem colide):
 *   `semearBancoUx02` (pelo BANCO — o que nenhuma tela desta missão cria):
 *     - dono real (`papel_tenant = 'administrador'`, sem linha de Permissão);
 *     - DUAS fazendas com fuso `America/Sao_Paulo`: SEDE (E1) e RETIRO (E2);
 *     - E1: Produto A "Diesel" (KG) com dois lotes de custo distinto
 *       (50 kg a 5,2000/kg e 100 kg a 5,5000/kg — vetor `fifo`) e Produto B
 *       "Diesel S10 Estoque Novo" (KG) com um lote próprio (200 kg a
 *       6,1000/kg), ambos no local "TANQUE DIESEL SEDE";
 *     - E2: Produto "Diesel Retiro" (KG) com um lote (80 kg a 5,9000/kg) no
 *       local "TANQUE RETIRO";
 *     - cada lote com a sua Entrada e `estoque_atual` coerente.
 *   NENHUM combustível, vínculo, fator ou bem: o combustível "Diesel S10" e a
 *   associação Diesel S10 → Diesel são feitos PELA TELA no roteiro.
 *   `semearBensUx02` (pela API REAL, depois que a tela criou o combustível):
 *     - catálogo padrão do Patrimônio (idempotente: o DIESEL_S10 criado pela
 *       tela conta como "existente"; cria famílias, tipos, Gasolina etc.);
 *     - "Trator 01" (horímetro 1.520,5 h há 10 dias; 1 tanque de 180 L que
 *       permite Diesel S10);
 *     - "Caminhonete 01" (odômetro 45.000 km; 1 tanque de 80 L que permite só
 *       Gasolina — combustível SEM Produto associado nesta fazenda).
 *
 * Decimais só como texto/`Prisma.Decimal` (nunca `Number`/float).
 * SÓ roda contra PostgreSQL local (mesma guarda dos moldes).
 */
import { randomUUID } from 'node:crypto';

import { exigirBancoLocal } from './e2e-lancamentos-seed.mjs';

export { exigirBancoLocal };

export const SENHA_E2E_UX02 = 'senha-e2e-ux02-abastecimentos-1';
export const FUSO_E2E_UX02 = 'America/Sao_Paulo';

/** Produtos e lotes (kg e custo/kg em texto canônico). */
export const PRODUTOS_UX02 = Object.freeze({
  A: Object.freeze({
    chave: 'A',
    empresa: 'E1',
    numero: '1',
    nome: 'Diesel',
    local: 'SEDE',
    lotes: Object.freeze([
      Object.freeze({ kg: '50.0000', custo: '5.2000', diasAtras: 40, doc: 'NF-DIESEL-1' }),
      Object.freeze({ kg: '100.0000', custo: '5.5000', diasAtras: 25, doc: 'NF-DIESEL-2' }),
    ]),
  }),
  B: Object.freeze({
    chave: 'B',
    empresa: 'E1',
    numero: '2',
    nome: 'Diesel S10 Estoque Novo',
    local: 'SEDE',
    lotes: Object.freeze([Object.freeze({ kg: '200.0000', custo: '6.1000', diasAtras: 5, doc: 'NF-DIESEL-NOVO-1' })]),
  }),
  R: Object.freeze({
    chave: 'R',
    empresa: 'E2',
    numero: '3',
    nome: 'Diesel Retiro',
    local: 'RETIRO',
    lotes: Object.freeze([Object.freeze({ kg: '80.0000', custo: '5.9000', diasAtras: 15, doc: 'NF-RETIRO-1' })]),
  }),
});

/** Dia de hoje no fuso da fazenda (AAAA-MM-DD). */
export const hojeEm = (fuso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const somarDias = (d, n) => {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/**
 * Parte do BANCO: tenant, dono, duas fazendas, locais, Produtos e lotes coerentes.
 * @param {{ rotulo?: string }} [opcoes]
 */
export const semearBancoUx02 = async (opcoes = {}) => {
  exigirBancoLocal();
  const { Prisma } = await import('@prisma/client');
  const { getPrismaClient } = await import('../../backend/src/database/prismaClient.js');
  const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');
  const { reservarNumero, ESCOPO_TENANT } = await import('../../backend/src/modules/sequencias/entidadeCodigoService.js');
  const prisma = getPrismaClient();

  const sufixo = randomUUID().slice(0, 8);
  const rotulo = String(opcoes.rotulo || 'e2e').replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'e2e';
  const login = `dono-ux02-${rotulo}-${sufixo}`;
  const senhaHash = await gerarSenhaHash(SENHA_E2E_UX02);
  const hoje = hojeEm(FUSO_E2E_UX02);

  return prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({ data: { codigo: `e2e-ux02-${rotulo}-${sufixo}`, nome: `FAZENDA UX02 ${rotulo.toUpperCase()}` } });
    const c = cliente.id;
    const dono = await tx.usuario.create({ data: { cliente_id: c, nome: 'DONO DA FAZENDA', login, senha_hash: senhaHash, papel_tenant: 'administrador' } });
    const e1 = await tx.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'SEDE', nome: 'FAZENDA SANTA LUZIA', fuso_horario: FUSO_E2E_UX02 } });
    const e2 = await tx.empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'RETIRO', nome: 'FAZENDA RETIRO', fuso_horario: FUSO_E2E_UX02 } });
    const empresas = { E1: e1, E2: e2 };
    const locais = {
      SEDE: await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'TANQUE DIESEL SEDE' } }),
      RETIRO: await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '2', nome: 'TANQUE RETIRO' } }),
    };

    /** @type {Record<string, any>} */
    const produtos = {};
    for (const p of Object.values(PRODUTOS_UX02)) {
      const empresa = empresas[p.empresa];
      const local = locais[p.local];
      const base = { cliente_id: c, empresa_id: empresa.id };
      const produto = await tx.produto.create({
        data: { ...base, numero_produto: p.numero, nome_produto: p.nome, unidade_principal_estoque: 'KG', unidade_medida: 'KG' },
      });
      const lotes = [];
      let saldo = new Prisma.Decimal(0);
      for (const l of p.lotes) {
        const data = somarDias(hoje, -l.diasAtras);
        const kg = new Prisma.Decimal(l.kg);
        const numero = String(await reservarNumero(tx, { clienteId: c, entidade: 'MovimentacaoEstoque', escopoTipo: ESCOPO_TENANT }));
        const movimento = await tx.movimentacaoEstoque.create({
          data: {
            ...base,
            numero_movimentacao: numero,
            tipo_movimentacao: 'Entrada',
            tipo_detalhado: 'saldo_inicial',
            data_movimentacao: new Date(`${data}T12:00:00.000Z`),
            produto_id: produto.id,
            produto_nome: produto.nome_produto,
            quantidade: kg.toFixed(4),
            unidade_medida: 'KG',
            valor_unitario: l.custo,
            valor_total: kg.times(new Prisma.Decimal(l.custo)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4),
            local_estoque_destino: local.id,
            local_destino: local.nome,
            numero_documento: l.doc,
            data_documento: new Date(`${data}T00:00:00.000Z`),
            motivo_movimentacao: 'Saldo inicial do ensaio E2E-2 (UX-02) de abastecimentos',
            saldo_antes: saldo.toFixed(4),
            saldo_depois: saldo.plus(kg).toFixed(4),
            usuario_responsavel: login,
            status: 'Ativa',
          },
        });
        saldo = saldo.plus(kg);
        const lote = await tx.estoqueLoteNota.create({
          data: {
            ...base,
            produto_id: produto.id,
            produto_nome: produto.nome_produto,
            local_estoque_id: local.id,
            local_estoque_nome: local.nome,
            numero_documento: l.doc,
            data_documento: new Date(`${data}T00:00:00.000Z`),
            custo_unitario: l.custo,
            quantidade_entrada: kg.toFixed(4),
            quantidade_disponivel: kg.toFixed(4),
            movimentacao_entrada_id: movimento.id,
            status: 'Disponivel',
          },
        });
        lotes.push({ id: lote.id, kg: l.kg, custo: l.custo, data, movimento_id: movimento.id });
      }
      await tx.produto.update({ where: { id: produto.id }, data: { estoque_atual: saldo.toFixed(4) } });
      produtos[p.chave] = { id: produto.id, nome: produto.nome_produto, empresa_id: empresa.id, local: { id: local.id, nome: local.nome }, lotes, estoque: saldo.toFixed(4) };
    }

    return {
      cliente_id: c,
      hoje,
      usuario_id: dono.id,
      credenciais: { login, senha: SENHA_E2E_UX02 },
      empresas: {
        E1: { id: e1.id, nome: e1.nome, apelido: e1.apelido },
        E2: { id: e2.id, nome: e2.nome, apelido: e2.apelido },
      },
      locais: { SEDE: { id: locais.SEDE.id, nome: locais.SEDE.nome }, RETIRO: { id: locais.RETIRO.id, nome: locais.RETIRO.nome } },
      produtos,
    };
  });
};

/**
 * Parte da API REAL (depois que a TELA criou o combustível "Diesel S10"):
 * catálogo padrão, Trator 01 (Diesel S10) e Caminhonete 01 (só Gasolina).
 * `api(metodo, caminho, corpo)` → `{ status, corpo }` já autenticada como o dono
 * (o caminho é o da API nativa, sem o prefixo `/api/native`).
 * @param {any} s @param {(metodo: string, caminho: string, corpo?: unknown) => Promise<{ status: number, corpo: any }>} api
 */
export const semearBensUx02 = async (s, api) => {
  const { getPrismaClient } = await import('../../backend/src/database/prismaClient.js');
  const prisma = getPrismaClient();
  const exigir = (r, status, oque) => {
    if (r.status !== status) throw new Error(`${oque}: HTTP ${r.status} ${JSON.stringify(r.corpo).slice(0, 300)}`);
    return r.corpo;
  };
  const padrao = exigir(await api('POST', '/patrimonio-catalogo-padrao', {}), 200, 'catálogo padrão do Patrimônio');
  const porCodigo = async (delegado) =>
    Object.fromEntries((await delegado.findMany({ where: { cliente_id: s.cliente_id }, select: { id: true, codigo: true } })).map((r) => [r.codigo, r.id]));
  const fam = await porCodigo(prisma.familiaPatrimonial);
  const tip = await porCodigo(prisma.tipoPatrimonial);
  const comb = await porCodigo(prisma.tipoCombustivel);
  if (!comb.DIESEL_S10 || !comb.GASOLINA) throw new Error(`combustíveis esperados ausentes: ${JSON.stringify(Object.keys(comb))}`);
  const trator = exigir(
    await api('POST', '/bens-patrimoniais', {
      empresa_id: s.empresas.E1.id,
      nome: 'Trator 01',
      familia_id: fam.MAQUINAS,
      tipo_id: tip.TRATOR_PNEUS,
      codigo_frota: 'TR-01',
      marca: 'Valtra',
      modelo: 'A950',
      medidor: { tipo: 'HORIMETRO', leitura_inicial: '1520.5', data_leitura: somarDias(s.hoje, -10) },
      tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', combustivel_ids: [comb.DIESEL_S10] }],
    }),
    201,
    'Trator 01',
  );
  const caminhonete = exigir(
    await api('POST', '/bens-patrimoniais', {
      empresa_id: s.empresas.E1.id,
      nome: 'Caminhonete 01',
      familia_id: fam.VEICULOS,
      tipo_id: tip.CAMINHONETE,
      codigo_frota: 'CM-01',
      marca: 'Toyota',
      modelo: 'Hilux',
      medidor: { tipo: 'ODOMETRO', leitura_inicial: '45000', data_leitura: somarDias(s.hoje, -10) },
      tanques: [{ identificador: 'Tanque da caminhonete', capacidade_litros: '80', combustivel_ids: [comb.GASOLINA] }],
    }),
    201,
    'Caminhonete 01',
  );
  return {
    catalogo_padrao: padrao,
    combustiveis: { DIESEL_S10: comb.DIESEL_S10, GASOLINA: comb.GASOLINA },
    trator: { id: trator.id, numero: trator.numero, codigo_frota: trator.codigo_frota, nome: trator.nome, tanque_id: trator.tanques[0].id, versao: trator.versao },
    caminhonete: { id: caminhonete.id, numero: caminhonete.numero, codigo_frota: caminhonete.codigo_frota, nome: caminhonete.nome, tanque_id: caminhonete.tanques[0].id },
  };
};
