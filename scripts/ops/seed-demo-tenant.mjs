#!/usr/bin/env node
/**
 * Seed idempotente de dados mínimos de demonstração para **um** tenant existente.
 *
 * Não cria Cliente nem Usuario — o tenant já deve existir (bootstrap / produção).
 * Não versiona segredos: só `DATABASE_URL` no ambiente do operador.
 *
 * Proteções:
 *  - exige `SEED_CLIENTE_ID` e `SEED_EMPRESA_ID`;
 *  - com `NODE_ENV=production`, exige também `CONFIRM=sim` (só INSERT idempotente);
 *  - falha se o Cliente não existir;
 *  - não imprime `DATABASE_URL`.
 */

import { PrismaClient } from '@prisma/client';

import { env, ehProducao } from '../../backend/src/config/env.js';

/** Chaves estáveis — reexecução pula o que já existe. */
export const DEMO = Object.freeze({
  marcas: [
    { numero_marca: 'SEED-M01', nome: 'SEED MARCA DEMO 1', descricao: 'Marca de demonstração (ops seed)' },
    { numero_marca: 'SEED-M02', nome: 'SEED MARCA DEMO 2', descricao: 'Segunda marca demo' },
  ],
  setor: {
    numero_setor: 'SEED-S01',
    nome: 'Setor Demo Seed',
    sigla: 'SDS',
    tipo: 'Próprio',
  },
  categoria: {
    numero_categoria: 'SEED-CAT01',
    nome: 'Insumos Demo',
    descricao: 'Categoria raiz para testes de produto',
  },
  produto: {
    numero_produto: 'SEED-P01',
    nome_produto: 'Sal mineral demo',
    unidade_medida: 'KG',
    estoque_atual: 100,
  },
  lote: {
    numero_lote: 'SEED-L01',
    nome: 'Lote demo seed',
    quantidade_cabecas: 25,
    quantidade_entrada: 25,
    motivo_entrada: 'Compra',
    status: 'Ativo',
  },
  grupoAtividade: {
    nome_grupo: 'SEED Grupo Demo',
    descricao: 'Grupo mínimo para tarefa demo',
  },
  tipoTarefa: {
    nome_tipo: 'SEED Inspeção',
    descricao: 'Tipo de tarefa para seed demo',
  },
  lancamento: {
    titulo: '[SEED] Inspeção de pasto demo',
    tipo: 'Inspeção',
    status: 'Pendente',
    prioridade: 'Média',
  },
});

const falhar = (mensagem) => {
  console.error(`ops:seed-demo-tenant — FALHOU\n\n  ${mensagem}\n`);
  process.exit(1);
};

const texto = (nome) => {
  const valor = process.env[nome];
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
};

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ clienteId: string, empresaId: string }} ctx
 * @returns {Promise<{ criados: string[], ignorados: string[] }>}
 */
export const seedDemoTenant = async (prisma, { clienteId, empresaId }) => {
  const criados = [];
  const ignorados = [];

  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente) {
    throw new Error(`Cliente '${clienteId}' não encontrado.`);
  }
  if (!cliente.ativo) {
    throw new Error(`Cliente '${clienteId}' está inativo.`);
  }

  for (const item of DEMO.marcas) {
    const existente = await prisma.marca.findUnique({
      where: { cliente_id_numero_marca: { cliente_id: clienteId, numero_marca: item.numero_marca } },
    });
    if (existente) {
      ignorados.push(`Marca ${item.numero_marca}`);
      continue;
    }
    await prisma.marca.create({
      data: {
        cliente_id: clienteId,
        empresa_id: empresaId,
        numero_marca: item.numero_marca,
        nome: item.nome,
        descricao: item.descricao,
        ativo: true,
      },
    });
    criados.push(`Marca ${item.numero_marca} (${item.nome})`);
  }

  let setor = await prisma.setor.findUnique({
    where: { cliente_id_numero_setor: { cliente_id: clienteId, numero_setor: DEMO.setor.numero_setor } },
  });
  if (setor) {
    ignorados.push(`Setor ${DEMO.setor.numero_setor}`);
  } else {
    setor = await prisma.setor.create({
      data: {
        cliente_id: clienteId,
        empresa_id: empresaId,
        ...DEMO.setor,
        ativo: true,
      },
    });
    criados.push(`Setor ${DEMO.setor.numero_setor} (${DEMO.setor.nome})`);
  }

  let categoria = await prisma.categoria.findUnique({
    where: {
      cliente_id_numero_categoria: { cliente_id: clienteId, numero_categoria: DEMO.categoria.numero_categoria },
    },
  });
  if (categoria) {
    ignorados.push(`Categoria ${DEMO.categoria.numero_categoria}`);
  } else {
    categoria = await prisma.categoria.create({
      data: {
        cliente_id: clienteId,
        ...DEMO.categoria,
        ativo: true,
      },
    });
    criados.push(`Categoria ${DEMO.categoria.numero_categoria}`);
  }

  const produtoExistente = await prisma.produto.findUnique({
    where: {
      cliente_id_numero_produto: { cliente_id: clienteId, numero_produto: DEMO.produto.numero_produto },
    },
  });
  if (produtoExistente) {
    ignorados.push(`Produto ${DEMO.produto.numero_produto}`);
  } else {
    await prisma.produto.create({
      data: {
        cliente_id: clienteId,
        empresa_id: empresaId,
        numero_produto: DEMO.produto.numero_produto,
        nome_produto: DEMO.produto.nome_produto,
        categoria: categoria?.nome ?? DEMO.categoria.nome,
        unidade_medida: DEMO.produto.unidade_medida,
        estoque_atual: DEMO.produto.estoque_atual,
        ativo: true,
      },
    });
    criados.push(`Produto ${DEMO.produto.numero_produto}`);
  }

  const loteExistente = await prisma.lote.findUnique({
    where: { cliente_id_numero_lote: { cliente_id: clienteId, numero_lote: DEMO.lote.numero_lote } },
  });
  if (loteExistente) {
    ignorados.push(`Lote ${DEMO.lote.numero_lote}`);
  } else {
    await prisma.lote.create({
      data: {
        cliente_id: clienteId,
        empresa_id: empresaId,
        numero_lote: DEMO.lote.numero_lote,
        nome: DEMO.lote.nome,
        quantidade_cabecas: DEMO.lote.quantidade_cabecas,
        quantidade_entrada: DEMO.lote.quantidade_entrada,
        motivo_entrada: DEMO.lote.motivo_entrada,
        status: DEMO.lote.status,
        setor_id: setor?.id ?? null,
        setor_nome: setor?.nome ?? null,
      },
    });
    criados.push(`Lote ${DEMO.lote.numero_lote}`);
  }

  let grupo = await prisma.grupoAtividade.findUnique({
    where: {
      cliente_id_nome_grupo: { cliente_id: clienteId, nome_grupo: DEMO.grupoAtividade.nome_grupo },
    },
  });
  if (grupo) {
    ignorados.push(`GrupoAtividade ${DEMO.grupoAtividade.nome_grupo}`);
  } else {
    grupo = await prisma.grupoAtividade.create({
      data: {
        cliente_id: clienteId,
        nome_grupo: DEMO.grupoAtividade.nome_grupo,
        descricao: DEMO.grupoAtividade.descricao,
        ativo: true,
      },
    });
    criados.push(`GrupoAtividade ${DEMO.grupoAtividade.nome_grupo}`);
  }

  let tipoTarefa = await prisma.tipoTarefa.findUnique({
    where: {
      cliente_id_grupo_atividade_id_nome_tipo: {
        cliente_id: clienteId,
        grupo_atividade_id: grupo.id,
        nome_tipo: DEMO.tipoTarefa.nome_tipo,
      },
    },
  });
  if (tipoTarefa) {
    ignorados.push(`TipoTarefa ${DEMO.tipoTarefa.nome_tipo}`);
  } else {
    tipoTarefa = await prisma.tipoTarefa.create({
      data: {
        cliente_id: clienteId,
        nome_tipo: DEMO.tipoTarefa.nome_tipo,
        descricao: DEMO.tipoTarefa.descricao,
        grupo_atividade_id: grupo.id,
        grupo_atividade_nome: grupo.nome_grupo,
        ativo: true,
      },
    });
    criados.push(`TipoTarefa ${DEMO.tipoTarefa.nome_tipo}`);
  }

  const lote = await prisma.lote.findUnique({
    where: { cliente_id_numero_lote: { cliente_id: clienteId, numero_lote: DEMO.lote.numero_lote } },
  });

  const lancExistente = await prisma.lancamentoTarefa.findFirst({
    where: { cliente_id: clienteId, titulo: DEMO.lancamento.titulo },
  });
  if (lancExistente) {
    ignorados.push(`LancamentoTarefa (titulo fixo)`);
  } else {
    await prisma.lancamentoTarefa.create({
      data: {
        cliente_id: clienteId,
        empresa_id: empresaId,
        titulo: DEMO.lancamento.titulo,
        tipo: DEMO.lancamento.tipo,
        tipo_tarefa_id: tipoTarefa.id,
        tipo_tarefa_nome: tipoTarefa.nome_tipo,
        grupo_atividade_id: grupo.id,
        grupo_atividade_nome: grupo.nome_grupo,
        status: DEMO.lancamento.status,
        prioridade: DEMO.lancamento.prioridade,
        lote_id: lote?.id ?? null,
        lote_nome: lote?.nome ?? null,
        setor_nome: setor?.nome ?? null,
      },
    });
    criados.push('LancamentoTarefa demo');
  }

  return { criados, ignorados };
};

const principal = async () => {
  if (ehProducao() && texto('CONFIRM') !== 'sim') {
    falhar(
      'NODE_ENV=production exige CONFIRM=sim.\n' +
        '  Este script só faz INSERT idempotente; mesmo assim a confirmação explícita é obrigatória.'
    );
  }

  if (!env.databaseUrl) falhar('DATABASE_URL ausente.');

  const clienteId = texto('SEED_CLIENTE_ID');
  const empresaId = texto('SEED_EMPRESA_ID');

  if (!clienteId || !empresaId) {
    falhar(
      'defina SEED_CLIENTE_ID e SEED_EMPRESA_ID.\n' +
        '  Exemplo (tenant MAIKE produção):\n' +
        '    SEED_CLIENTE_ID=ca98fddc19f711cde8c2a6383 \\\n' +
        '    SEED_EMPRESA_ID=empresa-maike-principal \\\n' +
        '    CONFIRM=sim NODE_ENV=production \\\n' +
        '    DATABASE_URL=\'postgresql://...\' \\\n' +
        '    node scripts/ops/seed-demo-tenant.mjs'
    );
  }

  const prisma = new PrismaClient();
  try {
    const { criados, ignorados } = await seedDemoTenant(prisma, { clienteId, empresaId });
    console.log('ops:seed-demo-tenant — concluído\n');
    if (criados.length) {
      console.log('  Criados:');
      for (const linha of criados) console.log(`    + ${linha}`);
    }
    if (ignorados.length) {
      console.log('  Já existiam (ignorados):');
      for (const linha of ignorados) console.log(`    · ${linha}`);
    }
    if (!criados.length && !ignorados.length) {
      console.log('  Nada a fazer.');
    }
  } finally {
    await prisma.$disconnect();
  }
};

if (process.argv[1] && process.argv[1].endsWith('seed-demo-tenant.mjs')) {
  await principal().catch((erro) => falhar(erro instanceof Error ? erro.message : String(erro)));
}
