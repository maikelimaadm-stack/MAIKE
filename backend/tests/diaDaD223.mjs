/**
 * D-PROD-249 — os testes de migration ANTIGOS rodam "no dia da D-PROD-223" (`20261117300000_descanso_e_alturas_por_area`,
 * a última aplicada em produção antes da CONTRACT das áreas da atividade, `20261118100000_atividade_areas`).
 *
 * Por quê: esses testes aplicam pelo runner oficial "tudo o que pende" e comparam o banco com o `schema.prisma`. Com a
 * D-PROD-249 no repositório, o runner do repositório passa a ter mais uma CONTRACT pendente (que ele nunca aplica junto
 * de outra) e o `schema.prisma` passa a ter a tabela AtividadeArea e a coluna do lançamento. Como nos espelhos da
 * D-PROD-208 (`espelhoDoRunner.mjs`), o teste antigo continua provando o que provava, na ordem de produção: o runner
 * vem de um ESPELHO com as pastas até a D-PROD-223 e o schema do `migrate diff` / `migrate status` é o do espelho — o
 * `schema.prisma` de hoje SEM o que a D-PROD-249 acrescentou (o model AtividadeArea, a coluna, a relação e o índice da
 * área no lançamento e as relações inversas). A D-PROD-249 tem a prova própria em `atividadeAreasMigration.test.mjs`.
 *
 * O espelho é criado uma vez por processo (na primeira chamada) e apagado na saída do processo.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarEspelhoDoRunner } from './espelhoDoRunner.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A última migration de produção antes da D-PROD-249 (o "dia" destes testes). */
export const ATE_D223 = '20261117300000_descanso_e_alturas_por_area';
/** A CONTRACT das áreas da atividade (D-PROD-249), fora do "dia" destes testes. */
export const NOME_ATIVIDADE_AREAS = '20261118100000_atividade_areas';

/** Só as pastas do dia da D-PROD-223. @param {string[]} nomes */
export const ateD223 = (nomes) => nomes.filter((n) => n <= ATE_D223);

/**
 * O `schema.prisma` de hoje sem o que a D-PROD-249 acrescentou: o model AtividadeArea (e a documentação dele), toda
 * linha que cita `AtividadeArea` ou `atividade_area_id` e as linhas `///` logo acima delas.
 * @param {string} schema
 */
export const schemaSemAreasDaAtividade = (schema) => {
  const linhas = schema.split('\n');
  const sai = new Array(linhas.length).fill(false);
  for (let i = 0; i < linhas.length; i += 1) {
    if (/^model AtividadeArea \{/.test(linhas[i])) {
      let j = i;
      while (j < linhas.length && linhas[j].trim() !== '}') sai[j++] = true;
      sai[j] = true;
      i = j;
      continue;
    }
    if (/AtividadeArea\b|atividade_area_id/.test(linhas[i])) sai[i] = true;
  }
  for (let i = linhas.length - 1; i > 0; i -= 1) {
    if (sai[i] && /^\s*\/\/\//.test(linhas[i - 1])) sai[i - 1] = true;
    if (sai[i] && /^\s*\/\/ D-PROD-249/.test(linhas[i - 1])) sai[i - 1] = true;
  }
  return linhas.filter((_, i) => !sai[i]).join('\n');
};

/**
 * D-PROD-257 — o `schema.prisma` de hoje sem as Entradas do Estoque: os 3 models `EntradaEstoque*`, toda linha que cita
 * `EntradaEstoque` (as relações inversas em Cliente, Empresa, Produto, LocalEstoque, camada e movimento) e as linhas
 * `///` e `// D-PROD-257` logo acima delas. A migration `20261119100000_estoque_entradas` fica de fora das pastas dos
 * espelhos (todas anteriores a ela) e tem a prova própria em `estoqueEntradas.test.mjs` e `premerge-migrate.test.mjs`.
 * D-PROD-264: também sem a saída manual do Estoque (os 4 models `MotivoSaidaEstoque`/`SaidaEstoque*` e as relações
 * inversas), posterior às Entradas: `20261120100000_estoque_saidas` fica igualmente fora das pastas dos espelhos.
 * D-PROD-272: e sem o ajuste de inventário (os 3 models `AjusteEstoque*` e as relações inversas), posterior à saída:
 * `20261120300000_estoque_ajustes` também fica fora das pastas dos espelhos.
 * @param {string} schema
 */
export const schemaSemEntradasDoEstoque = (schema) => {
  const linhas = schema.split('\n');
  const sai = new Array(linhas.length).fill(false);
  for (let i = 0; i < linhas.length; i += 1) {
    // D-PROD-259: o cadastro de motivos de entrada também é das Entradas (não existe no dia da D-PROD-249).
    // D-PROD-264: a saída manual do Estoque (MotivoSaidaEstoque e os 3 SaidaEstoque*), posterior a elas, também não.
    // D-PROD-272: nem o ajuste de inventário (os 3 AjusteEstoque*), posterior à saída.
    if (/^model ((Motivo)?(Entrada|Saida)|Ajuste)Estoque\w* \{/.test(linhas[i])) {
      let j = i;
      while (j < linhas.length && linhas[j].trim() !== '}') sai[j++] = true;
      sai[j] = true;
      i = j;
      continue;
    }
    if (/EntradaEstoque|entradasEstoque|itemEntradaEstoque|SaidaEstoque|saidasEstoque|itemSaidaEstoque|AjusteEstoque|ajustesEstoque|itemAjusteEstoque/.test(linhas[i])) sai[i] = true;
  }
  for (let i = linhas.length - 1; i > 0; i -= 1) {
    if (sai[i] && /^\s*(\/\/\/|\/\/ D-PROD-257|\/\/ D-PROD-264|\/\/ D-PROD-272|\/\/ -{10,})/.test(linhas[i - 1])) sai[i - 1] = true;
  }
  return linhas.filter((_, i) => !sai[i]).join('\n');
};

/**
 * D-PROD-265 — o `schema.prisma` de hoje sem a data de término do apontamento (`AtividadeApontamento.data_termino` e as
 * linhas `///` logo acima dela). A CONTRACT `20261120200000_apontamento_data_termino` é posterior a todos os "dias" destes
 * espelhos e tem a prova própria em `premerge-migrate.test.mjs` (B39) e no teste do registro de campo.
 * @param {string} schema
 */
export const schemaSemDataTermino = (schema) => {
  const linhas = schema.split('\n');
  const sai = linhas.map((l) => /^\s+data_termino\s/.test(l));
  for (let i = linhas.length - 1; i > 0; i -= 1) if (sai[i] && /^\s*\/\/\//.test(linhas[i - 1])) sai[i - 1] = true;
  return linhas.filter((_, i) => !sai[i]).join('\n');
};

/**
 * D-PROD-274 — o `schema.prisma` de hoje sem os campos de cada tipo da Nova realização: o model `AtividadePlantio` (e a
 * documentação dele), toda linha que cita `AtividadePlantio` (as relações em Cliente, Empresa, Atividade e Cultura), as 5
 * colunas novas (`Atividade.local`, `AtividadeApontamento.numero_receituario`, `AtividadeApontamentoProduto.vc_percentual`,
 * `Produto.carencia_dias` e `TipoAtividade.alvo`) e as linhas `///` e `// MAIKE-ENTREGA2` logo acima delas. A EXPAND
 * `20261121100000_atividade_campos_por_tipo` é posterior a todos os "dias" destes espelhos e tem a prova própria em
 * `premerge-migrate.test.mjs` (B41) e nos testes do registro de campo.
 * @param {string} schema
 */
export const schemaSemCamposPorTipo = (schema) => {
  const linhas = schema.split('\n');
  const sai = new Array(linhas.length).fill(false);
  for (let i = 0; i < linhas.length; i += 1) {
    if (/^model AtividadePlantio \{/.test(linhas[i])) {
      let j = i;
      while (j < linhas.length && linhas[j].trim() !== '}') sai[j++] = true;
      sai[j] = true;
      i = j;
      continue;
    }
    if (/AtividadePlantio\b/.test(linhas[i])) sai[i] = true;
    if (/^\s+(local\s+String\?\s+@db\.VarChar\(120\)|numero_receituario\s|vc_percentual\s|carencia_dias\s|alvo\s)/.test(linhas[i])) sai[i] = true;
  }
  for (let i = linhas.length - 1; i > 0; i -= 1) {
    if (sai[i] && /^\s*(\/\/\/|\/\/ MAIKE-ENTREGA2)/.test(linhas[i - 1])) sai[i - 1] = true;
  }
  return linhas.filter((_, i) => !sai[i]).join('\n');
};

/**
 * D-PROD-275 — o `schema.prisma` de hoje sem a reforma de pastagem: os models `Planejamento` e `PlanejamentoArea` (e a
 * documentação deles), toda linha que cita `Planejamento`/`PlanejamentoArea` (as relações em Cliente, Usuario, Empresa,
 * Cultura, AreaPastagem e Atividade), a coluna e o índice `planejamento_id` da Atividade e as linhas `///` e
 * `// MAIKE-ENTREGA3` logo acima delas. A EXPAND `20261122100000_reforma_planejamento` é posterior a todos os "dias" destes
 * espelhos e tem a prova própria em `premerge-migrate.test.mjs` (B42) e em `atividadeReforma.test.mjs`.
 * @param {string} schema
 */
export const schemaSemReforma = (schema) => {
  const linhas = schema.split('\n');
  const sai = new Array(linhas.length).fill(false);
  for (let i = 0; i < linhas.length; i += 1) {
    if (/^model Planejamento(Area)? \{/.test(linhas[i])) {
      let j = i;
      while (j < linhas.length && linhas[j].trim() !== '}') sai[j++] = true;
      sai[j] = true;
      i = j;
      continue;
    }
    if (/\bPlanejamento(Area)?\b|planejamento_id/.test(linhas[i])) sai[i] = true;
  }
  for (let i = linhas.length - 1; i > 0; i -= 1) {
    if (sai[i] && /^\s*(\/\/\/|\/\/ MAIKE-ENTREGA3)/.test(linhas[i - 1])) sai[i - 1] = true;
  }
  return linhas.filter((_, i) => !sai[i]).join('\n');
};

let espelho = null;
/** O diretório do espelho do runner até a D-PROD-223, com o schema do dia dela. */
export const espelhoDoDiaD223 = () => {
  if (espelho) return espelho;
  espelho = criarEspelhoDoRunner({ raiz: RAIZ, ate: ATE_D223 }).dir;
  const destino = join(espelho, 'backend', 'prisma', 'schema.prisma');
  writeFileSync(destino, schemaSemReforma(schemaSemCamposPorTipo(schemaSemDataTermino(schemaSemEntradasDoEstoque(schemaSemAreasDaAtividade(readFileSync(join(RAIZ, 'backend', 'prisma', 'schema.prisma'), 'utf8')))))));
  const dir = espelho;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return espelho;
};

/** O schema do dia da D-PROD-223 (no espelho, junto das pastas até ela: `migrate status` lê as pastas ao lado). */
export const schemaDoDiaD223 = () => join(espelhoDoDiaD223(), 'backend', 'prisma', 'schema.prisma');

// ─── o dia da D-PROD-249 (D-PROD-257) ──────────────────────────────────────
/** A migration das áreas da atividade: o "dia" do teste dela, antes das Entradas do Estoque (D-PROD-257). */
export const ATE_D249 = NOME_ATIVIDADE_AREAS;
/** Só as pastas até a D-PROD-249. @param {string[]} nomes */
export const ateD249 = (nomes) => nomes.filter((n) => n <= ATE_D249);

let espelho249 = null;
/** O espelho do runner até a D-PROD-249, com o schema do dia dela (o de hoje sem as Entradas do Estoque). */
export const espelhoDoDiaD249 = () => {
  if (espelho249) return espelho249;
  espelho249 = criarEspelhoDoRunner({ raiz: RAIZ, ate: ATE_D249 }).dir;
  const destino = join(espelho249, 'backend', 'prisma', 'schema.prisma');
  writeFileSync(destino, schemaSemReforma(schemaSemCamposPorTipo(schemaSemDataTermino(schemaSemEntradasDoEstoque(readFileSync(join(RAIZ, 'backend', 'prisma', 'schema.prisma'), 'utf8'))))));
  const dir = espelho249;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return espelho249;
};

/** O schema do dia da D-PROD-249 (no espelho, junto das pastas até ela). */
export const schemaDoDiaD249 = () => join(espelhoDoDiaD249(), 'backend', 'prisma', 'schema.prisma');
