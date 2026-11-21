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
import { deUnidades, ehPositivo, lerNumeroLocal, multiplicarArredondar, naEscala, paraTextoDeEdicao, paraUnidades, percentualDe, somar } from './dinheiroDecimal.js';
import { LIMITES_DECIMAL_ATIVIDADE, LOCALE_ATIVIDADE, STATUS_ABERTA } from './lancamentoAtividadesRegras.js';
import { STATUS_AREA, hectaresCanonicos } from './atividadeAreasRegras.js';
import { lerErroGestao } from './gestaoErros.js';
import { lerVc } from './camposPorTipo.js';
import { quantidadeFeitaDoServico } from './servicoVariosDias.js';

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
  // D-PROD-270: o VC (%) da semente só vai quando preenchido e válido (sem ele, a linha de sempre).
  ...(itens.produtos.length
    ? { produtos: itens.produtos.map((i) => { const vc = lerVc(i.form?.vc).valor; return { ...corpoDaLinhaProduto(i.form), ...(vc ? { vc_percentual: vc } : {}) }; }) }
    : {}),
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

// ─── Várias áreas num registro (D-PROD-263) ──────────────────────────────

/** O teto de áreas num registro (o mesmo do servidor). */
export const AREAS_NO_REGISTRO_MAXIMO = 20;

/**
 * Uma área do registro, com os textos de edição (pt-BR): o % do tamanho e os hectares feitos nela. Os dois andam juntos
 * (% = hectares ÷ tamanho × 100); o que vai para o servidor são os hectares.
 * @typedef {{ area_id: string, percentual: string, hectares: string }} AreaDoRegistro
 */

const CASAS_HA = LIMITES_DECIMAL_ATIVIDADE.casas;
const CASAS_PCT = 2;
const LIMITES_PCT = Object.freeze({ inteiros: 6, casas: CASAS_PCT });

/** O tamanho da área do mapa (canônico, 4 casas) quando é maior que zero; senão null. @param {any} areaDoMapa */
export const tamanhoDaArea = (areaDoMapa) => {
  const t = hectaresCanonicos(areaDoMapa?.tamanho_hectares);
  return t !== null && ehPositivo(t) ? naEscala(t, CASAS_HA) : null;
};

/** Hectares = tamanho × % ÷ 100, com 4 casas (meio para cima). @param {string} tamanho @param {string} percentual */
export const hectaresDoPercentual = (tamanho, percentual) =>
  // tamanho × % com 2 casas (meio para cima) = os hectares × 100 com 4 casas: as mesmas unidades, lidas com 4 casas.
  deUnidades(paraUnidades(multiplicarArredondar(tamanho, percentual, CASAS_HA - 2), CASAS_HA - 2), CASAS_HA);

/** % = hectares ÷ tamanho × 100, com 2 casas (meio para cima). @param {string} hectares @param {string} tamanho */
export const percentualDosHectares = (hectares, tamanho) => percentualDe(naEscala(hectares, CASAS_HA), tamanho, CASAS_HA, CASAS_PCT);

/** @param {string} canonico @param {number} casas */
const paraEdicao = (canonico, casas) => paraTextoDeEdicao(canonico, LOCALE_ATIVIDADE, { casasMax: casas });

/**
 * A área que entra no registro: 100% do tamanho (sem tamanho, % e hectares vazios: a pessoa digita os hectares).
 * @param {any} areaDoMapa @returns {AreaDoRegistro}
 */
export const areaNovaDoRegistro = (areaDoMapa) => {
  const t = tamanhoDaArea(areaDoMapa);
  return { area_id: String(areaDoMapa?.id ?? ''), percentual: t ? '100' : '', hectares: t ? paraEdicao(t, CASAS_HA) : '' };
};

/**
 * Marca ou desmarca uma área do mapa no registro (a marcada entra no fim, com 100%); `travadas` nunca saem e o teto não
 * é passado.
 * @param {AreaDoRegistro[]} linhas @param {any} areaDoMapa @param {{ travadas?: Set<string> }} [opcoes] @returns {AreaDoRegistro[]}
 */
export const alternarAreaNoRegistro = (linhas, areaDoMapa, { travadas } = {}) => {
  const id = String(areaDoMapa?.id ?? '');
  if (!id) return linhas;
  if (linhas.some((l) => l.area_id === id)) return travadas?.has(id) ? linhas : linhas.filter((l) => l.area_id !== id);
  if (linhas.length >= AREAS_NO_REGISTRO_MAXIMO) return linhas;
  return [...linhas, areaNovaDoRegistro(areaDoMapa)];
};

/**
 * A pessoa digitou o %: os hectares acompanham (tamanho × %). % inválido ou área sem tamanho: só o texto muda.
 * @param {AreaDoRegistro} linha @param {string} texto @param {any} areaDoMapa @returns {AreaDoRegistro}
 */
export const comPercentualDigitado = (linha, texto, areaDoMapa) => {
  const t = tamanhoDaArea(areaDoMapa);
  const lido = lerNumeroLocal(texto, LOCALE_ATIVIDADE, LIMITES_PCT);
  if (!t || !lido.ok) return { ...linha, percentual: texto };
  return { ...linha, percentual: texto, hectares: paraEdicao(hectaresDoPercentual(t, /** @type {string} */ (lido.valor)), CASAS_HA) };
};

/**
 * A pessoa digitou os hectares: o % acompanha (hectares ÷ tamanho). Hectares inválidos: só o texto muda; apagados, o %
 * também se apaga.
 * @param {AreaDoRegistro} linha @param {string} texto @param {any} areaDoMapa @returns {AreaDoRegistro}
 */
export const comHectaresDigitados = (linha, texto, areaDoMapa) => {
  const t = tamanhoDaArea(areaDoMapa);
  if (!String(texto ?? '').trim()) return { ...linha, hectares: texto, percentual: '' };
  const lido = lerNumeroLocal(texto, LOCALE_ATIVIDADE, LIMITES_DECIMAL_ATIVIDADE);
  if (!t || !lido.ok) return { ...linha, hectares: texto };
  return { ...linha, hectares: texto, percentual: paraEdicao(/** @type {string} */ (percentualDosHectares(/** @type {string} */ (lido.valor), t)), CASAS_PCT) };
};

/**
 * Os hectares digitados → canônico (o `hectares` de `areas[]`), ou a frase do erro.
 * @param {unknown} texto @returns {{ valor: string|null, erro: string|null }}
 */
export const lerHectaresDaArea = (texto) => {
  const t = String(texto ?? '').trim();
  if (!t) return { valor: null, erro: 'Informe os hectares feitos nesta área.' };
  const lido = lerNumeroLocal(t, LOCALE_ATIVIDADE, LIMITES_DECIMAL_ATIVIDADE);
  if (!lido.ok) return { valor: null, erro: 'Os hectares estão em formato inválido: use 1.234,5.' };
  if (!ehPositivo(/** @type {string} */ (lido.valor))) return { valor: null, erro: 'Os hectares têm de ser maiores que zero.' };
  return { valor: /** @type {string} */ (lido.valor), erro: null };
};

/**
 * Os erros das áreas do registro: `areas` (nenhuma escolhida), `area:<id>` (os hectares) e `pct:<id>` (o % digitado
 * inválido: os hectares não acompanharam).
 * @param {AreaDoRegistro[]} linhas @returns {Record<string, string>}
 */
export const errosDasAreasDoRegistro = (linhas) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!linhas.length) erros.areas = 'Escolha a área.';
  for (const l of linhas) {
    const h = lerHectaresDaArea(l.hectares);
    if (h.erro) erros[`area:${l.area_id}`] = h.erro;
    if (String(l.percentual ?? '').trim() && !lerNumeroLocal(l.percentual, LOCALE_ATIVIDADE, LIMITES_PCT).ok) erros[`pct:${l.area_id}`] = 'O % está em formato inválido: use 60 ou 33,33.';
  }
  return erros;
};

/** O corpo `areas[]` do registro: `[{ area_id, hectares }]`, na ordem da tabela. @param {AreaDoRegistro[]} linhas */
export const corpoDasAreasDoRegistro = (linhas) => linhas.map((l) => ({ area_id: l.area_id, hectares: /** @type {string} */ (lerHectaresDaArea(l.hectares).valor) }));

/**
 * Os totais da tabela das áreas: Σ tamanho e Σ hectares válidos (canônicos, 4 casas); sem nenhum, null.
 * @param {AreaDoRegistro[]} linhas @param {any[]} areasDoMapa
 */
export const totaisDasAreasDoRegistro = (linhas, areasDoMapa) => {
  const tamanhos = linhas.map((l) => tamanhoDaArea(areasDoMapa.find((a) => String(a?.id) === l.area_id))).filter((v) => v !== null);
  const hectares = linhas.map((l) => lerHectaresDaArea(l.hectares).valor).filter((v) => v !== null);
  return {
    tamanho: tamanhos.length ? somar(/** @type {string[]} */ (tamanhos), CASAS_HA) : null,
    hectares: hectares.length ? somar(/** @type {string[]} */ (hectares), CASAS_HA) : null,
  };
};

/**
 * O nome que o servidor dá à atividade nova (`nomeDoRegistro`): `<Tipo> · <Área> · <mmm/aa>`, ou, com outras áreas,
 * `<Tipo> · <Área 1> +N · <mmm/aa>`. Só para a prévia (o servidor ainda corta o que passa do teto).
 * @param {string} tipo @param {string} area @param {string} dia @param {number} [outras]
 */
export const nomeDaAtividadeNova = (tipo, area, dia, outras = 0) => `${tipo} · ${area}${outras > 0 ? ` +${outras}` : ''} · ${rotuloDoMesCurto(dia)}`;

/** "PASTO 01" / "PASTO 01 e PASTO 02" / "PASTO 01, PASTO 02 e PASTO 03". @param {string[]} nomes */
const lista = (nomes) => (nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

/** "dd/mm" de um dia `AAAA-MM-DD`. @param {string} dia */
const diaCurtoDoRegistro = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** D-PROD-267 — a trava "serviço parado" do servidor (`DIAS_PARADO_MAXIMO`). */
const DIAS_PARADO = 30;

/**
 * D-PROD-267 — a atividade aberta que o registro acharia (a mesma regra do servidor: a ABERTA da operação com a área não
 * concluída, em QUALQUER mês), com o que a prévia mostra. Sem nenhuma (ou com mais de uma na mesma área), null.
 * D-PROD-270: no Plantio de pastagem (`culturaId`), só a do MESMO capim (capim diferente abre outra).
 * @param {{ tipo: any, areas: Array<{ id: string, nome: string }>, resumos: Array<any|null|undefined>, culturaId?: string|null }} p
 * @returns {{ indice: number, alvo: any, varias: boolean } | null}
 */
export const atividadeDoRegistro = ({ tipo, areas, resumos, culturaId = null }) => {
  if (!tipo?.id) return null;
  for (const [i] of areas.entries()) {
    const abertas = (Array.isArray(resumos[i]?.atividades) ? resumos[i].atividades : []).filter(
      (/** @type {any} */ a) =>
        String(a.tipo_atividade_id) === String(tipo.id) && a.status === STATUS_ABERTA && a.area_status !== STATUS_AREA.CONCLUIDA
        && (!culturaId || String(a.plantio_cultura_id ?? '') === String(culturaId)),
    );
    if (abertas.length) return { indice: i, alvo: abertas[0], varias: abertas.length > 1 };
  }
  return null;
};

/**
 * Onde o registro entra (só leitura: quem decide é o servidor, com a mesma regra): as áreas na ordem da tabela, a
 * primeira com atividade ABERTA da operação (área não concluída) dá a atividade — D-PROD-267: em QUALQUER mês, e com o
 * andamento ("Entra em … (em andamento, 8 de 40 ha)"); parada há mais de 30 dias, avisa que o salvar vai perguntar. Com
 * várias áreas, diz quais entram nela e avisa da que já está concluída nela (o servidor recusa). Sem nenhuma: a
 * atividade nova, com o nome dela (o mês do início). `resumos[i]` é o resumo da área i
 * (`GET /atividades-por-area/:id/resumo`); faltando algum, null (ainda lendo).
 * D-PROD-270: `culturaId` (o capim do Plantio de pastagem) entra na regra, como no servidor; `capim` (o nome dele) vai na
 * frase ("Entra em SEMEADURA DE CAPIM · PASTO DA AROEIRA · nov/26 · capim PANICUM CV. MOMBAÇA (em andamento, …)"): dois
 * plantios na mesma área têm o mesmo nome e só o capim os distingue.
 * @param {{ tipo: any, areas: Array<{ id: string, nome: string }>, dia: string, resumos: Array<any|null|undefined>, culturaId?: string|null,
 *   capim?: string|null }} p
 * @returns {string|null}
 */
export const destinoDoRegistro = ({ tipo, areas, dia, resumos, culturaId = null, capim = null }) => {
  if (!tipo?.id || !areas.length || !dia || resumos.length !== areas.length || resumos.some((r) => !r)) return null;
  const achada = atividadeDoRegistro({ tipo, areas, resumos, culturaId });
  const comCapim = comOCapim(capim);
  if (achada) {
    const area = areas[achada.indice];
    if (achada.varias) return `Entra em uma das atividades de ${tipo.nome_tipo}${comCapim} abertas ${areas.length > 1 ? `em ${area.nome}` : 'nesta área'}`;
    const alvo = achada.alvo;
    const ultimo = typeof alvo.ultimo_dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(alvo.ultimo_dia) ? alvo.ultimo_dia : null;
    const parado = ultimo && Math.round((Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${ultimo}T00:00:00Z`)) / 86400000) > DIAS_PARADO;
    const avisoParado = parado ? `. Parada desde ${diaCurtoDoRegistro(/** @type {string} */ (ultimo))}: ao salvar, vamos perguntar se é continuação` : '';
    if (areas.length === 1) {
      const feita = alvo.area_executada != null ? hectaresCanonicos(alvo.area_executada) : null;
      const planejada = alvo.area_planejada != null ? hectaresCanonicos(alvo.area_planejada) : null;
      const fmt = (/** @type {string} */ v) => paraTextoDeEdicao(v, LOCALE_ATIVIDADE, { casasMax: CASAS_HA });
      const comDia = feita !== null && ehPositivo(feita);
      const andamento = comDia
        ? `em andamento, ${fmt(feita)}${planejada !== null ? ` de ${fmt(planejada)}` : ''} ha`
        : `planejada${planejada !== null ? `, ${fmt(planejada)} ha` : ''}`;
      return `Entra em ${alvo.nome}${comCapim} (${andamento})${avisoParado}`;
    }
    const naAlvo = (/** @type {number} */ j) => (Array.isArray(resumos[j]?.atividades) ? resumos[j].atividades : []).find((/** @type {any} */ a) => String(a.atividade_id) === String(alvo.atividade_id)) ?? null;
    const entram = areas.filter((_, j) => j !== achada.indice && !naAlvo(j)).map((a) => a.nome);
    const concluidas = areas.filter((_, j) => j !== achada.indice && naAlvo(j)?.area_status === STATUS_AREA.CONCLUIDA).map((a) => a.nome);
    const partes = [`Entra em ${alvo.nome}${comCapim}`];
    if (entram.length) partes.push(`${lista(entram)} ${entram.length === 1 ? 'entra' : 'entram'} nela`);
    let texto = partes.join('; ');
    if (concluidas.length) texto += `. ${lista(concluidas)} já ${concluidas.length === 1 ? 'está concluída' : 'estão concluídas'} nela: reabra ou tire do registro`;
    return `${texto}${avisoParado}`;
  }
  return `Nova atividade será criada: ${nomeDaAtividadeNova(tipo.nome_tipo, areas[0].nome, dia, areas.length - 1)}${comCapim}`;
};

/** " · capim PANICUM CV. MOMBAÇA" (o capim na prévia); sem capim, "". @param {string|null|undefined} capim */
const comOCapim = (capim) => {
  const c = String(capim ?? '').trim();
  return c ? ` · capim ${c}` : '';
};

/**
 * D-PROD-270 — onde o registro SEM área (Manutenção e Outros, com o local) entra: o servidor continua o serviço ABERTO da
 * operação no MESMO local (sem área) ou cria um. `abertas` é o que a tela leu com a mesma busca
 * (`GET /atividades?status=ABERTA&tipo_atividade_id=…&local=…`): com uma, "Entra em <nome> (em andamento, 1,2 km)" (parada
 * há mais de 30 dias, avisa que o salvar vai perguntar); sem nenhuma, "Nova atividade será criada: <Tipo> · <LOCAL> ·
 * <mmm/aa>". Sem a leitura (`abertas` nulo: lendo, sem permissão ou falhou), as duas possibilidades.
 * @param {{ tipo: any, local: string, dia: string, abertas?: any[]|null }} p @returns {string|null}
 */
export const destinoSemArea = ({ tipo, local, dia, abertas = null }) => {
  const l = String(local ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!tipo?.id || !l || !dia) return null;
  const nova = `${tipo.nome_tipo} · ${l} · ${rotuloDoMesCurto(dia)}`;
  if (!Array.isArray(abertas)) return `Se já houver ${tipo.nome_tipo} aberta em ${l}, entra nela; senão, nova atividade será criada: ${nova}`;
  // A mesma regra do servidor: aberta, da operação, no local exato, sem área (a lista já veio filtrada; a tela confere).
  const doLocal = abertas.filter(
    (a) => a && String(a.tipo_atividade_id) === String(tipo.id) && a.status === STATUS_ABERTA && String(a.local ?? '') === l && !(Array.isArray(a.areas) && a.areas.length),
  );
  if (!doLocal.length) return `Nova atividade será criada: ${nova}`;
  if (doLocal.length > 1) return `Entra em uma das atividades de ${tipo.nome_tipo} abertas em ${l}`;
  const alvo = doLocal[0];
  const ultimo = typeof alvo.andamento?.ultimo_dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(alvo.andamento.ultimo_dia) ? alvo.andamento.ultimo_dia : null;
  const parado = ultimo && Math.round((Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${ultimo}T00:00:00Z`)) / 86400000) > DIAS_PARADO;
  const avisoParado = parado ? `. Parada desde ${diaCurtoDoRegistro(/** @type {string} */ (ultimo))}: ao salvar, vamos perguntar se é continuação` : '';
  const comDia = Number(alvo.andamento?.lancamentos ?? 0) > 0 || Boolean(ultimo);
  const feita = quantidadeFeitaDoServico(alvo);
  const andamento = comDia ? `em andamento${feita ? `, ${feita}` : ''}` : 'planejada';
  return `Entra em ${alvo.nome} (${andamento})${avisoParado}`;
};

/**
 * A área que a recusa do servidor aponta (`details.area_indice` = a posição em `areas[]` enviada, com o `area_id`), ou
 * null (a recusa não é de uma área).
 * @param {unknown} erro @param {Array<{ area_id: string }>|null|undefined} enviadas
 * @returns {{ indice: number, area_id: string } | null}
 */
export const areaDaRecusa = (erro, enviadas) => {
  const { details } = lerErroGestao(erro);
  if (!Array.isArray(enviadas) || !Number.isInteger(details.area_indice)) return null;
  const indice = /** @type {number} */ (details.area_indice);
  const area = enviadas[indice];
  if (!area || (details.area_id != null && String(details.area_id) !== String(area.area_id))) return null;
  return { indice, area_id: String(area.area_id) };
};

/**
 * D-PROD-265 — o período do serviço registrado ("10/11 a 12/11"): só com a data de término DEPOIS do início; sem término
 * (ou igual ao início), vazio — o dia já aparece onde o lançamento é mostrado.
 * @param {unknown} inicio  `data_operacional` (AAAA-MM-DD) @param {unknown} termino  `data_termino` (AAAA-MM-DD ou nulo)
 * @returns {string}
 */
export const periodoDoServico = (inicio, termino) => {
  const dia = (/** @type {unknown} */ v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const de = dia(inicio);
  const ate = dia(termino);
  if (!de || !ate || ate <= de) return '';
  const curto = (/** @type {string} */ v) => `${v.slice(8, 10)}/${v.slice(5, 7)}`;
  return `${curto(de)} a ${curto(ate)}`;
};

/**
 * D-PROD-265 — a data de término do formulário: vazia vale (um dia só); preenchida, nunca antes do início nem depois de
 * hoje na fazenda. Devolve a mensagem do campo ou null.
 * @param {string} inicio @param {string} termino @param {string|null|undefined} hoje
 * @returns {string|null}
 */
export const erroDaDataDeTermino = (inicio, termino, hoje) => {
  if (!termino) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(termino)) return 'Informe a data de término no formato dd/mm/aaaa.';
  if (inicio && termino < inicio) return 'A data de término não pode ser antes da data de início.';
  if (hoje && termino > hoje) return 'A data de término não pode ser depois de hoje na fazenda.';
  return null;
};

