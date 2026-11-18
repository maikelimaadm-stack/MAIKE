/**
 * Porta nativa de AreaPastagem (P4.2, D-PROD-31).
 *
 * **Única** porta de dados de área no frontend. Depois desta missão não existe
 * mais caminho de `AreaPastagem` até a Base44: nem como origem de leitura, nem
 * como destino de escrita, nem como fallback quando o backend não responde.
 * Fallback silencioso para o sistema antigo é o pior desfecho possível numa
 * migração — a tela mostra dado, ninguém percebe que veio do lugar errado, e as
 * duas bases divergem sem aviso.
 *
 * ─── O que sai daqui na rede ───────────────────────────────────────────────
 *
 * O corpo é montado por **lista literal de campos**, nunca por spread do objeto
 * da tela. `FormularioArea` monta o formulário de edição a partir do registro
 * inteiro, então o objeto que chega aqui carrega `id`, `numero_area`,
 * `setor_nome`, `created_date`, `updated_date` e, quando nasceu offline,
 * `_isOffline` e um id `offline_…`. O backend recusa todos com 400
 * (`additionalProperties: false`), e está certo.
 *
 * `setor_nome` é o campo que mais importa nessa lista. Ele descreve o setor
 * vinculado, e quem sabe o nome do setor é o servidor, que tem a linha. Mandá-lo
 * daqui reabriria a divergência que a missão fecha — e o backend o recusaria de
 * qualquer forma. Ele simplesmente não entra no corpo.
 *
 * ─── `filterAreas` ─────────────────────────────────────────────────────────
 *
 * Vira filtro em memória sobre a lista, e isso é deliberado. O único uso real
 * (`ImportarGeoJSON`) filtra por `empresa_id`, e o resto da aplicação já faz
 * exatamente isso: `mapaCacheService` e `mapaService` chamam `listAreas()` e
 * filtram por empresa no cliente. Criar uma segunda forma de rede para o mesmo
 * recorte produziria uma segunda chave de cache offline sobre o mesmo agregado
 * — dois caches da mesma coisa, divergindo quando um for invalidado e o outro
 * não. Uma lista, um cache, um filtro.
 *
 * ─── Offline ───────────────────────────────────────────────────────────────
 *
 * Mesma composição de `Setor`: cache, fila e replay sobre operações nativas,
 * com `tenantScoped: true` — a fila carrega dono, e uma operação enfileirada
 * por um cliente nunca é aplicada dentro de outro que entre depois no mesmo
 * navegador (D-PROD-25 §L).
 *
 * O que o registro offline **não** tem: `numero_area` e `setor_nome`. Os dois
 * vêm do servidor — um da sequência, outro da linha do setor. Inventá-los aqui
 * seria o `MAX + 1` de volta, com o agravante de ser inventado sem ver a lista.
 *
 * `delete` não está no catálogo porque não existe rota de exclusão: a baixa de
 * área é lógica (`ativo: false`) e passa pelo `update`. Sem operação, o adapter
 * não cria `adapter.delete`, e a fila nunca enfileira uma exclusão que o
 * servidor recusaria para sempre.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'AreaPastagem';
const CAMINHO = '/areas-pastagem';

/** Nome literal da entidade no catálogo offline. Rótulo, não resolução. */
export const ENTIDADE_OFFLINE = 'AreaPastagem';

const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * Campos aceitos na CRIAÇÃO.
 *
 * `empresa_id` entra aqui e só aqui: na criação ele define a empresa da área;
 * na edição, mudá-lo moveria o vínculo de tudo que a cita. O backend recusa
 * `empresa_id` no PATCH pelo mesmo motivo.
 *
 * `setor_nome` e `numero_area` não aparecem em lista nenhuma — são do servidor.
 */
const CAMPOS_DE_CRIACAO = Object.freeze([
  'empresa_id',
  'setor_id',
  'nome',
  'sigla',
  'tamanho_hectares',
  'area_pastejada',
  'capacidade_maxima',
  'tipo_pastagem',
  // D-PROD-216: a cultura do cadastro de Culturas (o servidor deriva `tipo_pastagem` do nome dela).
  'cultura_id',
  'aproveitamento_classificacao',
  'tipo_cultura',
  'cor',
  'quantidade_atual',
  'status_ocupacao',
  'forragem_kg_ha',
  'taxa_crescimento_kg_ha_dia',
  'taxa_aproveitamento',
  'periodo_estacao',
  'coordenadas',
  'observacoes',
  'ativo',
  // D-PROD-223: parâmetros próprios do pasto (vazio = os da cultura).
  'altura_entrada_cm',
  'altura_saida_cm',
  'dias_descanso',
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

/**
 * Aplica um critério de igualdade sobre a lista já carregada.
 *
 * Igualdade estrita, campo a campo. Não existe operador, faixa nem `LIKE`: o
 * único critério usado hoje é `{ empresa_id }`, e inventar uma linguagem de
 * consulta que ninguém pede produziria semântica para manter sem consumidor.
 *
 * @param {any[]} registros
 * @param {Record<string, unknown>} criterio
 */
export const filtrarEmMemoria = (registros, criterio) =>
  registros.filter((registro) =>
    Object.entries(criterio ?? {}).every(([campo, valor]) => registro?.[campo] === valor)
  );

/** Operações online, sem offline nenhum. Exportadas para teste direto. */
export const operacoesNativas = Object.freeze({
  /** @returns {Promise<unknown>} */
  list: () => nativeRequest(CAMINHO, { autenticado: true }, ctx('listAreas')),

  /** @param {Record<string, unknown>} dados */
  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createArea')
    ),

  /**
   * Corpo vazio não vai à rede (G4). O PATCH exige ao menos um campo e
   * responderia 400 — e, no replay da fila offline, um 400 permanente travava
   * todas as pendências que vêm depois (ex.: `{ numero_area }` enfileirado
   * antes de a renumeração ter rota própria). Sem nada a gravar, a operação é
   * um no-op confirmado: devolve só o id, e o cache fica como está.
   *
   * @param {string} id
   * @param {Record<string, unknown>} dados
   */
  update: async (id, dados) => {
    const corpo = corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO);
    if (Object.keys(corpo).length === 0) return { id };
    return nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpo, autenticado: true },
      ctx('updateArea')
    );
  },
});

/** O PATCH tem algo a gravar com estes dados? */
export const temCampoDeAtualizacao = (dados) => Object.keys(corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO)).length > 0;

/**
 * Reatribuição de `numero_area` (G4): `POST /areas-pastagem/renumerar`, em
 * lote e atômica no servidor (troca 1↔2 sem colisão no unique). Online sempre:
 * fora do runtime offline, nunca vai para a fila — um código que o servidor
 * recusa não pode aparecer como salvo no cache local.
 *
 * @param {Array<{id: string, numero_area: string | number}>} itens
 * @returns {Promise<{itens: any[]}>}
 */
export const renumerarAreasNativa = (itens) =>
  /** @type {Promise<{itens: any[]}>} */ (nativeRequest(
    `${CAMINHO}/renumerar`,
    {
      method: 'POST',
      body: { itens: itens.map((item) => ({ id: String(item.id), numero_area: String(item.numero_area).trim() })) },
      autenticado: true,
    },
    ctx('renumerarAreas')
  ));

/**
 * Porta efetiva: operações nativas compostas com o runtime offline.
 *
 * Sem IndexedDB — jsdom, SSR, navegador restrito — o adapter devolve as
 * operações intactas em vez de fingir uma persistência que não existe.
 */
export const areaPastagemPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
