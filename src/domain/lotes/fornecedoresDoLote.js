/**
 * Opções do seletor de fornecedor do Cadastro de Lotes (D-PROD-145).
 *
 * Parceiro/fornecedor INATIVO não é oferecido para vínculo novo; o que o lote
 * já aponta (valor salvo ou o escolhido agora) continua na lista, para o nome
 * seguir resolvível e exibido. Não muda a rota `/fornecedores` nem a projeção.
 *
 * @template {{ id?: string, ativo?: boolean }} T
 * @param {T[]} fornecedores
 * @param {Array<string|null|undefined>} idsAtuais
 * @returns {T[]}
 */
export const fornecedoresSelecionaveis = (fornecedores, idsAtuais = []) => {
  const manter = new Set(idsAtuais.filter((id) => typeof id === "string" && id));
  return (Array.isArray(fornecedores) ? fornecedores : []).filter(
    (f) => f && (f.ativo !== false || (typeof f.id === "string" && manter.has(f.id))),
  );
};
