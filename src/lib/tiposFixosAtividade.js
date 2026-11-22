/**
 * D-PROD-258 — os 7 TIPOS FIXOS dos serviços de pasto. O tipo fixo é a `categoria` do cadastro de operações (o "tipo de
 * atividade" de antes), agora obrigatória. Espelha `TIPOS_FIXOS_ATIVIDADE` do servidor (mesma ordem e mesmos valores):
 * os valores gravados são os do CHECK que o banco já tinha (sem mudar tabela), com o rótulo novo.
 *
 * Operação antiga com categoria fora dos 7 (sem categoria, COLHEITA, MANEJO_ANIMAL) aparece em "Outros" enquanto o script de
 * dados não a corrige; quem decide continua sendo o servidor.
 */

/** @type {ReadonlyArray<{ value: string, label: string }>} */
export const TIPOS_FIXOS_ATIVIDADE = Object.freeze([
  { value: "PREPARO_SOLO", label: "Preparo do solo" },
  // D-PROD-273: "Plantio de pastagem" (era "Formação de pastagem (plantio)"; o valor gravado continua PLANTIO).
  { value: "PLANTIO", label: "Plantio de pastagem" },
  { value: "TRATO_CULTURAL", label: "Fertilização" },
  { value: "APLICACAO", label: "Aplicação" },
  { value: "PASTAGEM", label: "Roçada e tratos" },
  { value: "BENFEITORIA", label: "Manutenção" },
  { value: "OUTROS", label: "Outros" },
]);

const VALORES = new Set(TIPOS_FIXOS_ATIVIDADE.map((t) => t.value));

/** O tipo fixo de uma operação: a categoria, se for um dos 7; senão Outros. @param {{ categoria?: string | null } | null | undefined} tipo */
export const tipoFixoDaOperacao = (tipo) => (typeof tipo?.categoria === "string" && VALORES.has(tipo.categoria) ? tipo.categoria : "OUTROS");

/** Rótulo do tipo fixo (Outros para o que não for um dos 7). @param {unknown} categoria */
export const rotuloDoTipoFixo = (categoria) => TIPOS_FIXOS_ATIVIDADE.find((t) => t.value === categoria)?.label ?? "Outros";

/** As operações ATIVAS de um tipo fixo, em ordem alfabética. @param {any[]} operacoes @param {string} tipoFixo */
export const operacoesDoTipoFixo = (operacoes, tipoFixo) =>
  (Array.isArray(operacoes) ? operacoes : [])
    .filter((o) => o && o.ativo !== false && tipoFixoDaOperacao(o) === tipoFixo)
    .sort((a, b) => String(a.nome_tipo ?? "").localeCompare(String(b.nome_tipo ?? ""), "pt-BR"));
