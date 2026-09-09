/**
 * Porta nativa de Setor (P4.1, D-PROD-25).
 *
 * **Única** porta de dados de Setor no frontend. O cadastro (`src/apis/setores`)
 * e o mapa (`src/apis/mapa`) passam por aqui — não por duas cópias que
 * divergiriam na primeira vez que uma das duas ganhasse um campo.
 *
 * Depois desta missão não existe mais caminho de Setor até a Base44: nem como
 * origem de leitura, nem como destino de escrita, nem como fallback quando o
 * backend nativo não responde. Fallback silencioso para o sistema antigo é o
 * pior desfecho possível numa migração — a tela mostra dado, ninguém percebe
 * que ele veio do lugar errado, e as duas bases divergem sem aviso.
 *
 * ─── O que sai daqui na rede ───────────────────────────────────────────────
 *
 * O corpo enviado é montado por **lista literal de campos**, nunca por spread
 * do objeto da tela. Não é preciosismo: `CadastroSetores` monta o formulário de
 * edição com `{...getInitialFormData(), ...setor}`, então o objeto que chega
 * aqui carrega `id`, `numero_setor`, `created_date`, `updated_date` e, quando o
 * registro nasceu offline, `_isOffline` e um id `offline_…`. O backend recusa
 * todos eles com 400 (`additionalProperties: false`), e ele está certo —
 * `id`, `cliente_id` e `numero_setor` são atribuídos pelo servidor.
 *
 * A consequência prática: um POST com o objeto inteiro falharia sempre, e o
 * replay da fila offline falharia para **todo** setor criado sem rede. Por isso
 * a filtragem mora aqui, na camada mais interna, e não no service: qualquer
 * caminho até a rede passa por este arquivo, inclusive o replay, que chama as
 * operações diretamente sem passar por service nenhum.
 *
 * ─── Offline ───────────────────────────────────────────────────────────────
 *
 * A composição com `createOfflineEntityAdapter` é a mesma que a Base44 tinha —
 * cache, fila e replay continuam funcionando, só que sobre operações nativas.
 * O que muda é o que o registro offline **não** tem: `numero_setor`. Ele vem da
 * sequência do banco, e a sequência é o servidor. Um número escolhido pelo
 * navegador seria exatamente o `MAX + 1` que esta missão removeu, com o
 * agravante de ser inventado sem ver a lista inteira.
 *
 * `delete` não está no catálogo de operações porque não existe rota de exclusão
 * (ver `backend/src/modules/setores/setorRoutes.js`). Sem operação, o adapter
 * offline não cria `adapter.delete`, e a fila nunca enfileira uma exclusão que
 * o servidor recusaria para sempre.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'Setor';
const CAMINHO = '/setores';

/** Nome literal da entidade no catálogo offline. Rótulo, não resolução. */
export const ENTIDADE_OFFLINE = 'Setor';

const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * Campos aceitos na CRIAÇÃO, na ordem do cadastro.
 *
 * `empresa_id` entra aqui e só aqui: na criação ele define a empresa do setor;
 * na edição, mudá-lo moveria por vínculo denormalizado todas as áreas, tarefas
 * e movimentações que citam este setor — operação própria, não campo de
 * formulário. O backend recusa `empresa_id` no PATCH pelo mesmo motivo.
 */
const CAMPOS_DE_CRIACAO = Object.freeze([
  'empresa_id',
  'nome',
  'sigla',
  'tipo',
  'responsavel',
  'telefone',
  'endereco',
  'cidade',
  'estado',
  'area_total',
  'capacidade_animais',
  'observacoes',
  'ativo',
]);

/** Campos aceitos na ATUALIZAÇÃO: os mesmos, menos `empresa_id`. */
const CAMPOS_DE_ATUALIZACAO = Object.freeze(
  CAMPOS_DE_CRIACAO.filter((campo) => campo !== 'empresa_id')
);

/** `''` vira `null` — o backend trata os dois igual, mas só um é honesto. */
const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/**
 * Monta o corpo com os campos permitidos que o chamador realmente informou.
 *
 * Campo ausente continua ausente: mandar `null` para tudo que a tela não tocou
 * apagaria dado numa atualização parcial.
 *
 * @param {Record<string, unknown>} dados
 * @param {readonly string[]} permitidos
 * @returns {Record<string, unknown>}
 */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(/** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

/** Operações online, sem offline nenhum. Exportadas para teste direto. */
export const operacoesNativas = Object.freeze({
  /** @returns {Promise<unknown>} */
  list: () => nativeRequest(CAMINHO, { autenticado: true }, ctx('listSetores')),

  /** @param {Record<string, unknown>} dados */
  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createSetor')
    ),

  /**
   * @param {string} id
   * @param {Record<string, unknown>} dados
   */
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateSetor')
    ),
});

/**
 * Porta efetiva: operações nativas compostas com o runtime offline.
 *
 * Sem IndexedDB — jsdom, SSR, navegador restrito — o adapter devolve as
 * operações intactas em vez de fingir uma persistência que não existe.
 */
export const setorPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
});
