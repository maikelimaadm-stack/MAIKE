/**
 * Cliente de dados temporário (Base44).
 *
 * Responsabilidade única desde a P1.4: ler a configuração de runtime, criar o
 * client e exportá-lo. Nada mais.
 *
 * Até a P1.3 este arquivo instalava três monkey patches globais sobre o SDK —
 * normalização de texto, guardas de exclusão e runtime offline. Cada um deles
 * mutava `client.entities[*]` e, com isso, mudava o comportamento de todo o
 * produto a partir de um `import` que ninguém lia. Os três viraram composição
 * explícita: normalização e runtime offline são aplicados pelo provider,
 * entidade por entidade, e a guarda de exclusão vive em
 * `src/services/deleteGuardService.js` com carregadores declarados.
 *
 * `requiresAuth: false` continua como está — DBT-02, endereçado na P3.
 */

import { createClient } from '@base44/sdk';
import { getDataProviderConfig } from '@/config/runtimeConfig';

const { appId, serverUrl, token, functionsVersion } = getDataProviderConfig();

export const base44 = createClient({
  appId,
  serverUrl,
  token,
  functionsVersion,
  requiresAuth: false
});
