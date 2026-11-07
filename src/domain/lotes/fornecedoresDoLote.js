/**
 * Opções do seletor de fornecedor do Cadastro de Lotes (D-PROD-146).
 *
 * Vínculo NOVO só com parceiro ATIVO e com papel FORNECEDOR (B4/R2). Contam como
 * fornecedor: o papel `fornecedor` e suas grafias antigas ("Fornecedor",
 * "fornecedores") e, só por retrocompatibilidade do cadastro antigo, `tipos`
 * vazio. Quem é apenas cliente, prestador, transportador ou outros não entra.
 *
 * O que o lote já aponta (valor salvo ou o escolhido agora) continua na lista
 * mesmo inativo ou com papel alterado, para o nome seguir resolvível e exibido
 * e o vínculo histórico nunca mudar sem pedido explícito. O servidor aplica a
 * mesma regra a todo vínculo novo. Não muda a rota `/fornecedores`.
 */

/** Grafias aceitas para o papel fornecedor (mesma normalização do servidor). */
const ALIASES_FORNECEDOR = new Set(["fornecedor", "fornecedores"]);
const normalizar = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");

/**
 * Papel fornecedor (ou legado sem papel)?
 * @param {unknown} tipos
 */
export const temPapelFornecedor = (tipos) => {
  if (!Array.isArray(tipos) || tipos.length === 0) return true;
  return tipos.some((t) => typeof t === "string" && ALIASES_FORNECEDOR.has(normalizar(t)));
};

/**
 * @template {{ id?: string, ativo?: boolean, tipos?: unknown }} T
 * @param {T[]} fornecedores
 * @param {Array<string|null|undefined>} idsAtuais
 * @returns {T[]}
 */
export const fornecedoresSelecionaveis = (fornecedores, idsAtuais = []) => {
  const manter = new Set(idsAtuais.filter((id) => typeof id === "string" && id));
  return (Array.isArray(fornecedores) ? fornecedores : []).filter(
    (f) => f && ((typeof f.id === "string" && manter.has(f.id)) || (f.ativo !== false && temPapelFornecedor(f.tipos))),
  );
};
