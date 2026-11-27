/**
 * D-PROD-251 — o fluxo de campo do Lançamento de Atividades.
 *
 * A atividade é o trabalho. A área (pasto ou talhão) é o lugar onde o custo entra.
 * Quem decide continua sendo o servidor: aqui só há rótulo, agrupamento e o texto
 * da confirmação. Nenhum número é inventado.
 */

import { areasDaAtividade, contadoresDasAreas, rotuloDaAreaDaAtividade, textoDaColunaArea } from './atividadeAreasRegras.js';
import {
  LINHA_MAO_OBRA,
  LINHA_MAQUINA,
  LINHA_PRODUTO,
  LINHA_SERVICO,
  formatarMoedaAtividade,
  formatarQuantidadeLinha,
  formatarQuantidadeMaoObra,
  linhasDoApontamento,
  rotuloDaMaoObraDaLinha,
  rotuloDaMaquinaDaLinha,
  rotuloDoImplementoDaLinha,
  rotuloDoProdutoDaLinha,
  rotuloDoServicoDaLinha,
  statusDaLinha,
} from './atividadeLinhasRegras.js';
import { STATUS_CANCELADO, STATUS_CONFIRMADO, formatarDiaAtividade, rotuloDoStatusAtividade } from './lancamentoAtividadesRegras.js';

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Grupos da escolha de áreas (pasto, lavoura, o resto). */
export const GRUPO_PASTO = 'pasto';
export const GRUPO_LAVOURA = 'lavoura';
export const GRUPO_OUTRA = 'outra';

/** Opções do "O que você quer registrar?" que não são uma linha do servidor. */
export const REGISTRO_IMPLEMENTO = 'implemento';

/**
 * Pasto, lavoura ou outra, pelo uso da área (`tipo_cultura`) e, se houver, pelo tipo da cultura.
 * Sem uso informado, conta como pasto: é o uso padrão da área neste produto.
 * @param {any} area
 * @returns {'pasto'|'lavoura'|'outra'}
 */
export const grupoDaArea = (area) => {
  const uso = texto(area?.tipo_cultura).toLowerCase();
  const tipo = texto(area?.cultura?.tipo).toUpperCase();
  if (uso === 'agricultura' || tipo === 'LAVOURA') return GRUPO_LAVOURA;
  if (uso === 'pastagem' || uso === '' || tipo === 'PASTAGEM') return GRUPO_PASTO;
  return GRUPO_OUTRA;
};

/** Rótulo do grupo na escolha de áreas. @param {string} grupo */
export const rotuloDoGrupoDeArea = (grupo) => (grupo === GRUPO_LAVOURA ? 'Lavouras' : grupo === GRUPO_OUTRA ? 'Outras áreas' : 'Pastos');

/**
 * Situação em palavras do dia a dia. "A começar" só quando a atividade está aberta e nenhuma área começou.
 * @param {any} atividade
 */
export const situacaoDaAtividade = (atividade) => {
  const status = texto(atividade?.status);
  if (status === 'CANCELADA') return 'Cancelada';
  if (status === 'CONCLUIDA') return 'Concluída';
  const areas = areasDaAtividade(atividade);
  if (status === 'ABERTA' && areas.length > 0 && areas.every((a) => a.status === 'PLANEJADA')) return 'A começar';
  if (status === 'ABERTA') return 'Em andamento';
  return rotuloDoStatusAtividade(status);
};

/** Rótulo da área no cartão de campo. @param {unknown} status */
export const rotuloDaAreaNoCampo = (status) => {
  const s = texto(status);
  if (s === 'PLANEJADA') return 'Ainda não começou';
  if (s === 'EM_ANDAMENTO') return 'Em andamento';
  if (s === 'CONCLUIDA') return 'Concluída';
  return s;
};

/**
 * Texto da lista quando há várias áreas. Uma área (ou nenhuma) continua com o nome.
 * "Começadas" = já iniciadas ou já feitas. Todas feitas: "N áreas feitas".
 * @param {any} atividade
 */
export const textoProgressoAreas = (atividade) => {
  const areas = areasDaAtividade(atividade);
  if (areas.length <= 1) return textoDaColunaArea(atividade);
  const c = contadoresDasAreas(atividade);
  if (c.concluidas === c.total) return `${c.total} áreas feitas`;
  const comecadas = c.emAndamento + c.concluidas;
  return `${comecadas} de ${c.total} áreas começadas`;
};

/**
 * "Pasto 01, Pasto 03 e mais 3". Sem área, "".
 * @param {any} atividade @param {number} [limite]
 */
export const resumoDosNomesDasAreas = (atividade, limite = 2) => {
  const nomes = areasDaAtividade(atividade).map((a) => rotuloDaAreaDaAtividade(a)).filter(Boolean);
  if (!nomes.length) return '';
  if (nomes.length <= limite) return nomes.join(', ');
  return `${nomes.slice(0, limite).join(', ')} e mais ${nomes.length - limite}`;
};

/**
 * O que o cadastro do tipo deixa registrar, em palavras simples.
 * Máquina entra sempre: a tela de campo oferece máquina em todo tipo (a regra de hoje).
 * @param {any} tipo
 */
export const textoDoQuePodeRegistrar = (tipo) => {
  /** @type {string[]} */
  const partes = ['Máquinas'];
  if (tipo?.permite_implemento === true) partes.push('implementos');
  if (tipo?.permite_produto === true) partes.push('produtos');
  if (tipo?.permite_mao_obra === true) partes.push('mão de obra');
  if (tipo?.permite_servico === true) partes.push('serviços');
  return partes.join(', ');
};

/**
 * O tipo de atividade que representa ABASTECIMENTO (emenda 1 da D-PROD-254). O cadastro de tipos não tem categoria para
 * isso: vale o nome, pelo mesmo critério do desenho do tipo (`abastec` / `combust`, sem acento nem caixa) e do servidor
 * (`ehTipoAbastecimento`, que recusa o tipo em `POST /atividades/registrar`). Esses tipos ficam fora dos quadros de Manejos
 * e da lista do "Registrar serviço": abastecer é da máquina.
 * @param {any} tipo
 */
export const ehTipoAbastecimento = (tipo) => /abastec|combust/.test(texto(tipo?.nome_tipo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());

/** Os tipos que se registram como trabalho de campo da área (sem o Abastecimento). @param {any[]} tipos */
export const tiposRegistraveisNaArea = (tipos) => (Array.isArray(tipos) ? tipos : []).filter((t) => t && !ehTipoAbastecimento(t));

/**
 * O bem (máquina) da linha, no formato que o formulário de Abastecimento espera (`bem.medidor.tipo` define o horímetro).
 * @param {{ id?: unknown, rotulo?: unknown, medidorTipo?: unknown }} maquina
 * @returns {{ id: string, nome: string, medidor: { tipo: string } } | null}
 */
export const bemParaAbastecer = (maquina) =>
  maquina?.id != null && texto(maquina.id)
    ? { id: texto(maquina.id), nome: texto(maquina.rotulo) || texto(maquina.id), medidor: { tipo: texto(maquina.medidorTipo) || 'SEM_MEDIDOR' } }
    : null;

/**
 * Movimentos CONFIRMADOS de uma área, agrupados por tipo, com o texto de cada linha.
 * Sem `areaId`, todas as linhas da atividade (atividade de uma área só, no cabeçalho).
 * Custo de cada grupo: a soma que o servidor mandou em `custoPorTipo`, quando houver.
 * @param {any[]} apontamentos
 * @param {string|null} areaId
 * @param {any} [custoPorTipo]
 */
export const movimentosDaArea = (apontamentos, areaId, custoPorTipo = null) => {
  /** @type {Record<string, Array<{ id: string, data: string, titulo: string, detalhe: string, custo: string }>>} */
  const grupos = {
    [LINHA_PRODUTO]: [],
    [LINHA_MAQUINA]: [],
    [REGISTRO_IMPLEMENTO]: [],
    [LINHA_MAO_OBRA]: [],
    [LINHA_SERVICO]: [],
  };
  const dias = (Array.isArray(apontamentos) ? apontamentos : []).filter((ap) => {
    if (!ap || ap.status !== STATUS_CONFIRMADO) return false;
    if (!areaId) return true;
    return String(ap.atividade_area_id ?? '') === String(areaId);
  });
  for (const ap of dias) {
    const data = formatarDiaAtividade(ap.data_operacional) || '';
    const linhas = linhasDoApontamento(ap);
    for (const l of linhas.produtos) {
      if (statusDaLinha(l) === STATUS_CANCELADO) continue;
      const qtd = formatarQuantidadeLinha(l.quantidade, l.unidade || l.produto?.unidade_sigla || '');
      grupos[LINHA_PRODUTO].push({
        id: String(l.id),
        data,
        titulo: rotuloDoProdutoDaLinha(l) || 'Produto',
        detalhe: [data, qtd].filter(Boolean).join(' · '),
        custo: formatarMoedaAtividade(l.custo_total) || '',
      });
    }
    for (const l of linhas.maquinas) {
      if (statusDaLinha(l) === STATUS_CANCELADO) continue;
      const impl = rotuloDoImplementoDaLinha(l);
      const maquina = rotuloDaMaquinaDaLinha(l) || 'Máquina';
      grupos[LINHA_MAQUINA].push({
        id: String(l.id),
        data,
        titulo: maquina,
        detalhe: [data, impl ? `com ${impl}` : ''].filter(Boolean).join(' · '),
        custo: formatarMoedaAtividade(l.custo_total) || '',
      });
      // O implemento é da linha da máquina: aparece no grupo dele, sem custo próprio (o custo está em Máquinas).
      if (impl) {
        grupos[REGISTRO_IMPLEMENTO].push({
          id: `${l.id}-implemento`,
          data,
          titulo: impl,
          detalhe: [data, `puxado por ${maquina}`].filter(Boolean).join(' · '),
          custo: '',
        });
      }
    }
    for (const l of linhas.mao_obra) {
      if (statusDaLinha(l) === STATUS_CANCELADO) continue;
      grupos[LINHA_MAO_OBRA].push({
        id: String(l.id),
        data,
        titulo: rotuloDaMaoObraDaLinha(l) || 'Mão de obra',
        detalhe: [data, formatarQuantidadeMaoObra(l.quantidade, l.tipo_medida)].filter(Boolean).join(' · '),
        custo: formatarMoedaAtividade(l.custo_total) || '',
      });
    }
    for (const l of linhas.servicos) {
      if (statusDaLinha(l) === STATUS_CANCELADO) continue;
      grupos[LINHA_SERVICO].push({
        id: String(l.id),
        data,
        titulo: rotuloDoServicoDaLinha(l) || 'Serviço',
        detalhe: [data, formatarQuantidadeLinha(l.quantidade, l.unidade || '')].filter(Boolean).join(' · '),
        custo: formatarMoedaAtividade(l.valor_total ?? l.custo_total) || '',
      });
    }
  }
  const rotulo = /** @type {Record<string, string>} */ ({
    [LINHA_PRODUTO]: 'Produtos',
    [LINHA_MAQUINA]: 'Máquinas',
    [REGISTRO_IMPLEMENTO]: 'Implementos',
    [LINHA_MAO_OBRA]: 'Mão de obra',
    [LINHA_SERVICO]: 'Serviços',
  });
  const campo = /** @type {Record<string, string>} */ ({
    [LINHA_PRODUTO]: 'produtos',
    [LINHA_MAQUINA]: 'maquinas',
    [LINHA_MAO_OBRA]: 'mao_obra',
    [LINHA_SERVICO]: 'servicos',
    [REGISTRO_IMPLEMENTO]: '',
  });
  return Object.keys(grupos)
    .map((id) => ({
      id,
      rotulo: rotulo[id],
      itens: grupos[id],
      // Implemento não tem custo próprio: o total é quantos usos, e o custo já está em Máquinas.
      total: id === REGISTRO_IMPLEMENTO ? (grupos[id].length ? `${grupos[id].length} ${grupos[id].length === 1 ? 'uso' : 'usos'}` : '') : formatarMoedaAtividade(custoPorTipo?.[campo[id]]) || '',
      nota: id === REGISTRO_IMPLEMENTO ? 'O custo do implemento já está em Máquinas.' : '',
    }))
    .filter((g) => g.itens.length > 0 || g.total);
};
