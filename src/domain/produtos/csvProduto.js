/**
 * Importação e exportação CSV de produtos — puro (P1.4).
 *
 * Saiu de dentro de `Produtos.jsx`, onde o `FileReader.onload` fazia parse,
 * validação, numeração e montagem de payload no mesmo lugar em que chamava o
 * provider. A leitura do arquivo continua na tela — é o usuário que escolhe o
 * arquivo. Daqui para baixo é texto entra, dado sai.
 *
 * Sem React, sem provider, sem `window`.
 *
 * D-PROD-161 (Estoque P0): a coluna `Estoque` continua no lugar (compatibilidade
 * com planilhas), mas o Cadastro de Produtos não importa saldo: vazia ou 0 dá
 * linha válida SEM `estoque_atual`; qualquer outro valor é erro explícito de
 * linha. O saldo entra por Entradas/Movimentações. A exportação continua
 * mostrando o saldo atual (somente leitura).
 */

import { parseDecimalPtBR } from '@/domain/numeroPtBR';

/** Ordem das colunas. É o contrato do template e da importação. */
export const COLUNAS_IMPORTACAO = Object.freeze([
  'Nome', 'Código', 'Cód Barras', 'Categoria', 'Descrição', 'UN',
  'Custo', 'Venda', 'Estoque', 'Mínimo', 'Obs',
]);

export const COLUNAS_EXPORTACAO = Object.freeze([
  'Nome', 'Código', 'Cód Barras', 'Categoria', 'Descrição', 'Unidade',
  'Custo', 'Venda', 'Estoque', 'Mínimo', 'Obs',
]);

const LINHA_EXEMPLO = Object.freeze([
  'PRODUTO EXEMPLO', '001', '7891234567890', 'CATEGORIA', 'DESCRIÇÃO', 'UN',
  '10,50', '15,00', '0', '10', 'OBS',
]);

/** Posição da coluna `Estoque` na importação. */
const COLUNA_ESTOQUE = COLUNAS_IMPORTACAO.indexOf('Estoque');

/** Erro de linha para Estoque ≠ 0/vazio (D-PROD-161). */
export const MENSAGEM_ESTOQUE_NAO_IMPORTADO =
  'Estoque não é importado pelo Cadastro de Produtos: o saldo entra por Entradas/Movimentações (use 0 ou deixe vazio)';

/** Célula Estoque vazia ou numericamente 0 (aceita `0`, `0,00`, `0.0`). Texto não numérico não é 0. */
const estoqueVazioOuZero = (valor) => {
  const texto = String(valor ?? '').trim();
  if (!texto) return true;
  return parseDecimalPtBR(texto) === 0;
};

const maiusculoOuIndefinido = (valor) => {
  const texto = String(valor ?? '').trim();
  return texto ? texto.toUpperCase() : undefined;
};

/** Campo com `;` vai entre aspas — senão quebra a própria separação. */
const celula = (valor) =>
  typeof valor === 'string' && valor.includes(';') ? `"${valor}"` : valor;

const linhaCsv = (valores) => valores.map(celula).join(';');

/** BOM UTF-8 para o Excel abrir acentuação corretamente. */
export const BOM_UTF8 = '﻿';

export const montarTemplateCsv = () =>
  [linhaCsv([...COLUNAS_IMPORTACAO]), linhaCsv([...LINHA_EXEMPLO])].join('\n');

export const montarCsvDeProdutos = (produtos) =>
  [
    linhaCsv([...COLUNAS_EXPORTACAO]),
    ...(Array.isArray(produtos) ? produtos : []).map((p) =>
      linhaCsv([
        p.nome_produto,
        p.codigo_interno || '',
        p.codigo_barras || '',
        p.categoria || '',
        p.descricao || '',
        p.unidade_medida,
        p.preco_custo || 0,
        p.preco_venda || 0,
        p.estoque_atual || 0,
        p.estoque_minimo || 0,
        p.observacoes || '',
      ])
    ),
  ].join('\n');

export const montarCsvDeErros = (erros) =>
  [
    linhaCsv(['Linha', 'Erro', ...COLUNAS_IMPORTACAO]),
    ...(Array.isArray(erros) ? erros : []).map((erro) =>
      linhaCsv([erro.linha, erro.erro, ...String(erro.dados ?? '').split(';')])
    ),
  ].join('\n');

/**
 * Converte o texto do CSV em registros prontos para persistir.
 *
 * Numeração (`numero_produto`) é atribuída pelo backend na criação — o CSV não
 * envia número. Linha sem nome é erro. Linha com Estoque ≠ 0/vazio é erro
 * (D-PROD-161): o registro válido nunca leva `estoque_atual`.
 *
 * @param {string} texto conteúdo do arquivo, já lido pela UI
 * @param {{empresaId: string}} p
 * @returns {{validos: Array<object>, erros: Array<{linha: number, erro: string, dados: string}>}}
 */
export const parseCsvDeProdutos = (texto, { empresaId }) => {
  const linhas = String(texto ?? '')
    .split('\n')
    .filter((linha) => linha.trim());

  const validos = [];
  const erros = [];

  if (linhas.length <= 1) return { validos, erros };

  for (let i = 1; i < linhas.length; i += 1) {
    const valores = linhas[i].split(';');

    const produto = {
      empresa_id: empresaId,
      nome_produto: maiusculoOuIndefinido(valores[0]),
      codigo_interno: maiusculoOuIndefinido(valores[1]),
      codigo_barras: String(valores[2] ?? '').trim() || undefined,
      categoria: maiusculoOuIndefinido(valores[3]),
      descricao: maiusculoOuIndefinido(valores[4]),
      unidade_medida: maiusculoOuIndefinido(valores[5]) || 'UN',
      preco_custo: parseDecimalPtBR(valores[6]) ?? 0,
      preco_venda: parseDecimalPtBR(valores[7]) ?? 0,
      estoque_minimo: parseDecimalPtBR(valores[9]) ?? 0,
      observacoes: maiusculoOuIndefinido(valores[10]),
    };

    if (!produto.nome_produto) {
      erros.push({ linha: i + 1, erro: 'Nome obrigatório', dados: linhas[i] });
      continue;
    }

    if (!estoqueVazioOuZero(valores[COLUNA_ESTOQUE])) {
      erros.push({ linha: i + 1, erro: MENSAGEM_ESTOQUE_NAO_IMPORTADO, dados: linhas[i] });
      continue;
    }

    validos.push(produto);
  }

  return { validos, erros };
};
