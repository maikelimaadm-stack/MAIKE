/**
 * Vínculo estrutural "o movimento do mapa cita estes lotes" — PR168-R2 (D-PROD-101).
 *
 * UMA definição usada pelo histórico por lote, pelas dependências do
 * cancelamento e pela guarda de exclusão do Cadastro (#167), para que as três
 * nunca discordem. Um movimento cita o lote quando o id aparece em:
 *   - `lote_id` (primário) ou `lote_destino_id` (R2A);
 *   - `lote_ids[]` (participantes do movimento agregado R2B);
 *   - `efeito_servidor.efeitos[].lote_id` (efeito comprovado);
 *   - `linhas[].maes_lote_ids[]` (lotes de MATRIZES considerados no
 *     nascimento — lotes da categoria materna na área, NÃO a mãe individual).
 * Tudo em SQL parametrizado; `lote_ids`, `linhas` e `efeito_servidor` são
 * campos reservados (só o servidor escreve).
 */

import { Prisma } from '@prisma/client';

const arrayOuVazio = (expr) => Prisma.sql`CASE WHEN jsonb_typeof(${expr}) = 'array' THEN ${expr} ELSE '[]'::jsonb END`;

/**
 * @param {string} alias alias da tabela "MovimentacaoMapa" na consulta (constante do código, nunca entrada)
 * @param {string[]} ids
 */
export const movimentoCitaLotes = (alias, ids) => {
  const m = Prisma.raw(alias);
  return Prisma.sql`(
    ${m}.dados->>'lote_id' = ANY(${ids}::text[])
    OR ${m}.dados->>'lote_destino_id' = ANY(${ids}::text[])
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${arrayOuVazio(Prisma.sql`${m}.dados->'lote_ids'`)}) AS vli(id) WHERE vli.id = ANY(${ids}::text[]))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(${arrayOuVazio(Prisma.sql`${m}.dados->'efeito_servidor'->'efeitos'`)}) AS vef(val) WHERE vef.val->>'lote_id' = ANY(${ids}::text[]))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(${arrayOuVazio(Prisma.sql`${m}.dados->'linhas'`)}) AS vln(val)
      CROSS JOIN LATERAL jsonb_array_elements_text(${arrayOuVazio(Prisma.sql`vln.val->'maes_lote_ids'`)}) AS vma(id)
      WHERE vma.id = ANY(${ids}::text[])
    )
  )`;
};
