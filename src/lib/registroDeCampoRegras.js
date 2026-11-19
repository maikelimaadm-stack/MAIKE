/** D-PROD-254 — peças puras do registro de campo e dos detalhes da área. */

import {
  campoDaLinhaRecusada,
  corpoDaLinhaMaoObra,
  corpoDaLinhaMaquina,
  corpoDaLinhaProduto,
  corpoDaLinhaServico,
  ehSaltoDoMedidor,
  formularioMaoObraVazio,
  formularioMaquinaVazio,
  formularioProdutoVazio,
  formularioServicoVazio,
  linhaEmbutidaRecusada,
  mensagemDeErroLinha,
  unidadeDoProduto,
  validarLinhaMaoObra,
  validarLinhaMaquina,
  validarLinhaProduto,
  validarLinhaServico,
} from './atividadeLinhasRegras.js';

const MESES_CURTOS = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);

/**
 * "2026-11-18" ou "2026-11" → "nov/26" (o mesmo texto que o servidor põe no nome da atividade); vazio se inválido.
 * @param {string|null|undefined} diaOuMes
 */
export const rotuloDoMesCurto = (diaOuMes) => {
  const m = typeof diaOuMes === 'string' ? /^(\d{4})-(\d{2})/.exec(diaOuMes) : null;
  const mes = m ? MESES_CURTOS[Number(m[2]) - 1] : undefined;
  return m && mes ? `${mes}/${m[1].slice(2)}` : '';
};

/** A raiz das consultas dos detalhes da área (resumo, registros e tipos); o registro novo invalida tudo dela. */
export const QUERY_ATIVIDADES_DA_AREA = 'atividades-da-area';

// ─── Várias linhas por seção (D-PROD-262) ────────────────────────────────

/**
 * As seções de linhas do "Registrar serviço", na ordem da tela (a da maquete "Nova realização"): cada uma é a coleção
 * do corpo de `POST /atividades/registrar`.
 * @typedef {'produtos'|'maquinas'|'mao_obra'|'servicos'} ColecaoDoRegistro
 */
export const COLECOES_DO_REGISTRO = Object.freeze(/** @type {ColecaoDoRegistro[]} */ (['produtos', 'maquinas', 'mao_obra', 'servicos']));

/**
 * Um item já incluído numa seção (uma linha da tabela). `form` é o formulário da linha (`JanelasDaLinha`). A máquina
 * guarda o medidor lido e a decisão da justificativa tomados no "Incluir" (`comJustificativa`) e se o servidor pediu a
 * justificativa (`saltoPedido`); o insumo guarda o nome do local escolhido (só para a tabela).
 * @typedef {{ chave: string, form: any, medidor?: any, comJustificativa?: boolean, saltoPedido?: boolean, localNome?: string|null }} ItemDoRegistro
 * @typedef {Record<ColecaoDoRegistro, ItemDoRegistro[]>} ItensDoRegistro
 */

/** @returns {ItensDoRegistro} */
export const itensVaziosDoRegistro = () => ({ produtos: [], maquinas: [], mao_obra: [], servicos: [] });

/** O formulário vazio do editor de cada seção (o mesmo das janelas da linha). @param {ColecaoDoRegistro} colecao */
export const formularioVazioDaSecao = (colecao) => {
  if (colecao === 'produtos') return formularioProdutoVazio();
  if (colecao === 'maquinas') return formularioMaquinaVazio();
  if (colecao === 'mao_obra') return formularioMaoObraVazio();
  return formularioServicoVazio();
};

/** O campo-chave de cada seção: sem ele o editor aberto não conta (fica de fora do envio). */
const CAMPO_CHAVE = Object.freeze(/** @type {Record<ColecaoDoRegistro, string>} */ ({ produtos: 'produto', maquinas: 'bem', mao_obra: 'parceiro', servicos: 'servico' }));

/** O campo-chave (produto, máquina, pessoa, serviço) foi escolhido? @param {ColecaoDoRegistro} colecao @param {any} form */
export const temChaveDaLinha = (colecao, form) => Boolean(form?.[CAMPO_CHAVE[colecao]]?.id);

/**
 * Só o erro do campo-chave, com a frase da validação da linha ("Escolha a máquina.", …): é o que aparece ao incluir sem
 * escolher o principal e quando a operação antiga exige máquina.
 * @param {ColecaoDoRegistro} colecao @param {any} form
 * @returns {Record<string, string>}
 */
export const erroDaChaveDaLinha = (colecao, form) => {
  const campo = CAMPO_CHAVE[colecao];
  /** @type {Record<string, string>} */
  let erros;
  if (colecao === 'produtos') erros = validarLinhaProduto(form).erros;
  else if (colecao === 'maquinas') erros = validarLinhaMaquina(form, { medidor: { contador: false }, permiteImplemento: true, pedeJustificativa: false });
  else if (colecao === 'mao_obra') erros = validarLinhaMaoObra(form);
  else erros = validarLinhaServico(form);
  return erros[campo] ? { [campo]: erros[campo] } : {};
};

/** A lista com o item: troca o da mesma chave no lugar; sem ele, vai para o fim. @param {ItemDoRegistro[]} lista @param {ItemDoRegistro} item */
export const comItem = (lista, item) => (lista.some((i) => i.chave === item.chave) ? lista.map((i) => (i.chave === item.chave ? item : i)) : [...lista, item]);

/**
 * As linhas do corpo, na ordem das tabelas; cada coleção só quando tem item. A máquina usa o medidor e a decisão da
 * justificativa guardados no "Incluir" (`corpoDaLinhaMaquina`); o resto, o formulário da linha.
 * @param {ItensDoRegistro} itens
 */
export const linhasDoCorpoDoRegistro = (itens) => ({
  ...(itens.maquinas.length ? { maquinas: itens.maquinas.map((i) => corpoDaLinhaMaquina(i.form, i.medidor, { comJustificativa: i.comJustificativa === true })) } : {}),
  ...(itens.produtos.length ? { produtos: itens.produtos.map((i) => corpoDaLinhaProduto(i.form)) } : {}),
  ...(itens.mao_obra.length ? { mao_obra: itens.mao_obra.map((i) => corpoDaLinhaMaoObra(i.form)) } : {}),
  ...(itens.servicos.length ? { servicos: itens.servicos.map((i) => corpoDaLinhaServico(i.form)) } : {}),
});

/**
 * O item que a recusa do servidor aponta. O índice é a posição no array ENVIADO (`linhaEmbutidaRecusada`: máquina, mão
 * de obra e serviço por `details.linha_indice` + `details.entidade`; produto por `details.colecao` + `details.indice`), e
 * cada array enviado tem os itens da tabela na mesma ordem. Sem índice, só a recusa de um campo da linha
 * (`campoDaLinhaRecusada`) vai para um item, e só quando não há dúvida: a única máquina no salto do medidor, ou o único
 * item enviado. Sem resposta, envio pendente ou recusa do dia: null.
 * @param {unknown} erro @param {ItensDoRegistro|null|undefined} enviados
 * @returns {{ colecao: ColecaoDoRegistro, item: ItemDoRegistro, numero: number } | null}
 */
export const itemDaRecusa = (erro, enviados) => {
  if (!enviados) return null;
  const alvo = linhaEmbutidaRecusada(erro);
  if (alvo) {
    const colecao = /** @type {ColecaoDoRegistro} */ (alvo.colecao);
    const item = enviados[colecao]?.[alvo.indice];
    return item ? { colecao, item, numero: alvo.indice + 1 } : null;
  }
  if (!campoDaLinhaRecusada(erro)) return null;
  if (ehSaltoDoMedidor(erro)) return enviados.maquinas.length === 1 ? { colecao: 'maquinas', item: enviados.maquinas[0], numero: 1 } : null;
  const todos = COLECOES_DO_REGISTRO.flatMap((colecao) => enviados[colecao].map((item, i) => ({ colecao, item, numero: i + 1 })));
  return todos.length === 1 ? todos[0] : null;
};

/**
 * A mensagem da recusa do registro, com a unidade do medidor da máquina recusada ou a do produto recusado.
 * @param {unknown} erro @param {ReturnType<typeof itemDaRecusa>} alvo
 */
export const mensagemDaRecusaDoRegistro = (erro, alvo) =>
  mensagemDeErroLinha(erro, 'Não foi possível registrar. Nada foi gravado.', {
    medidorUnidade: alvo?.colecao === 'maquinas' ? alvo.item.medidor?.unidade ?? null : null,
    unidade: alvo?.colecao === 'produtos' ? unidadeDoProduto(alvo.item.form?.produto) ?? null : null,
  });
