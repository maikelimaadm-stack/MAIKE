/**
 * DDL PROPOSTA do ledger pecuário — PROVA DE CONCEITO L1, NÃO É MIGRATION.
 *
 * Existe para que o serviço transacional seja exercitado contra PostgreSQL
 * real SEM tocar `backend/prisma/schema.prisma` (arquivo em uso pela PR #145).
 * Só pode ser aplicada num esquema descartável (ex.: `ledger_l1_<aleatório>`)
 * criado e destruído pelo próprio teste. `public` é recusado de propósito:
 * tabela em `public` fora do schema Prisma seria drift de SSOT.
 *
 * Identidade: aqui `bigint GENERATED ALWAYS AS IDENTITY` — o banco gera a PK
 * e o runtime nunca a fornece (gate:tenancy P3-TEN-RUNTIME-IDENTITY). É só
 * da prova de conceito: no L2 a PK passa a ser `String @id @default(cuid())`
 * do model Prisma, como todo o resto do schema.
 *
 * L2: estas tabelas viram models Prisma (FKs compostas com `cliente_id` para
 * Cliente/Empresa/AreaPastagem, onDelete Restrict) + migration aditiva
 * versionada + grants/RLS backend-only. O desenho abaixo é o insumo.
 */

import { randomUUID } from 'node:crypto';

import { CODIGOS_LEDGER_PECUARIO as C, LedgerPecuarioError } from './ledgerPecuarioErros.js';

/**
 * Namespace EXCLUSIVO dos esquemas descartáveis do L1. Só este formato é
 * aceito para criar, operar e — principalmente — `DROP SCHEMA … CASCADE`.
 * `public`, `auth`, `storage`, `pg_catalog`, `information_schema`, `prisma`,
 * esquemas de aplicação e qualquer outro nome ficam de fora por construção.
 */
const RE_ESQUEMA_L1 = /^ledger_l1_[0-9a-f]{12,32}$/;

/** Nome novo e inequívoco de esquema descartável (`ledger_l1_<12 hex>`). */
export const gerarEsquemaDescartavel = () => `ledger_l1_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

/**
 * @param {unknown} esquema
 * @returns {string} identificador já entre aspas, seguro para interpolar
 */
export const esquemaSeguro = (esquema) => {
  const nome = typeof esquema === 'string' ? esquema : '';
  if (!RE_ESQUEMA_L1.test(nome)) {
    throw new LedgerPecuarioError(C.ESQUEMA_INVALIDO, 'esquema do ledger inválido: L1 só opera em ledger_l1_<hex>', {
      details: { esquema: nome.slice(0, 64) },
    });
  }
  return `"${nome}"`;
};

/**
 * @param {string} esquema
 * @returns {string[]} instruções na ordem de execução
 */
export const ddlLedgerPecuario = (esquema) => {
  const s = esquemaSeguro(esquema);
  return [
    `CREATE SCHEMA IF NOT EXISTS ${s}`,
    `CREATE TABLE ${s}.ledger_pecuario_evento (
      id                    bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      cliente_id            varchar(64)  NOT NULL,
      empresa_id            varchar(64)  NOT NULL,
      tipo                  varchar(32)  NOT NULL CHECK (tipo IN ('ENTRADA', 'TRANSFERENCIA', 'ESTORNO')),
      operation_id          varchar(128) NOT NULL,
      data_operacional      date         NOT NULL,
      quantidade            integer      NOT NULL CHECK (quantidade > 0),
      categoria_chave       varchar(80)  NOT NULL,
      area_origem_id        varchar(64),
      area_destino_id       varchar(64),
      lote_referencia_id    varchar(64),
      estorno_de_evento_id  bigint,
      motivo                varchar(255),
      autor_usuario_id      varchar(64)  NOT NULL,
      request_id            varchar(128),
      created_at            timestamptz  NOT NULL DEFAULT now(),
      CONSTRAINT ledger_evento_operacao_uq UNIQUE (cliente_id, operation_id),
      CONSTRAINT ledger_evento_estorno_uq UNIQUE (cliente_id, estorno_de_evento_id),
      CONSTRAINT ledger_evento_origem_destino_ck
        CHECK (area_origem_id IS NULL OR area_destino_id IS NULL OR area_origem_id <> area_destino_id),
      CONSTRAINT ledger_evento_forma_ck CHECK (
        (tipo = 'ENTRADA' AND area_origem_id IS NULL AND area_destino_id IS NOT NULL AND estorno_de_evento_id IS NULL)
        OR (tipo = 'TRANSFERENCIA' AND area_origem_id IS NOT NULL AND area_destino_id IS NOT NULL AND estorno_de_evento_id IS NULL)
        OR (tipo = 'ESTORNO' AND estorno_de_evento_id IS NOT NULL)
      )
    )`,
    `CREATE INDEX ledger_evento_empresa_data_idx ON ${s}.ledger_pecuario_evento (cliente_id, empresa_id, data_operacional, created_at)`,
    `CREATE INDEX ledger_evento_lote_idx ON ${s}.ledger_pecuario_evento (cliente_id, lote_referencia_id) WHERE lote_referencia_id IS NOT NULL`,
    `CREATE TABLE ${s}.ledger_pecuario_partida (
      id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      evento_id        bigint      NOT NULL REFERENCES ${s}.ledger_pecuario_evento (id) ON DELETE RESTRICT,
      cliente_id       varchar(64) NOT NULL,
      empresa_id       varchar(64) NOT NULL,
      area_id          varchar(64) NOT NULL,
      categoria_chave  varchar(80) NOT NULL,
      delta            integer     NOT NULL CHECK (delta <> 0),
      created_at       timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX ledger_partida_posicao_idx ON ${s}.ledger_pecuario_partida (cliente_id, empresa_id, area_id, categoria_chave)`,
    `CREATE INDEX ledger_partida_evento_idx ON ${s}.ledger_pecuario_partida (evento_id)`,
    `CREATE TABLE ${s}.ledger_pecuario_posicao (
      cliente_id       varchar(64) NOT NULL,
      empresa_id       varchar(64) NOT NULL,
      area_id          varchar(64) NOT NULL,
      categoria_chave  varchar(80) NOT NULL,
      saldo            integer     NOT NULL DEFAULT 0 CHECK (saldo >= 0),
      versao           bigint      NOT NULL DEFAULT 0,
      atualizado_em    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (cliente_id, empresa_id, area_id, categoria_chave)
    )`,
    // Fatos são append-only no banco, não só por convenção do serviço.
    `CREATE FUNCTION ${s}.ledger_pecuario_bloquear_mutacao() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'ledger pecuário é append-only (% em %)', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
     END $$`,
    `CREATE TRIGGER ledger_evento_append_only BEFORE UPDATE OR DELETE ON ${s}.ledger_pecuario_evento
       FOR EACH ROW EXECUTE FUNCTION ${s}.ledger_pecuario_bloquear_mutacao()`,
    `CREATE TRIGGER ledger_partida_append_only BEFORE UPDATE OR DELETE ON ${s}.ledger_pecuario_partida
       FOR EACH ROW EXECUTE FUNCTION ${s}.ledger_pecuario_bloquear_mutacao()`,
  ];
};

/**
 * @param {string} esquema
 * @returns {string}
 */
export const ddlRemoverLedgerPecuario = (esquema) => `DROP SCHEMA IF EXISTS ${esquemaSeguro(esquema)} CASCADE`;
