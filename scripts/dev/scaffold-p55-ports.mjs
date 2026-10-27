#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const ENTITIES = [
  { name: 'MovimentacaoMapa', resource: 'MovimentacaoMapa', path: '/movimentacoes-mapa', offline: true },
  { name: 'MovimentacaoPecuaria', resource: 'MovimentacaoPecuaria', path: '/movimentacoes-pecuaria', offline: false },
  { name: 'SuplementacaoEvento', resource: 'SuplementacaoEvento', path: '/suplementacao-eventos', offline: true },
  { name: 'SuplementacaoLote', resource: 'SuplementacaoLote', path: '/suplementacao-lotes', offline: true, bulk: true },
  { name: 'AplicacaoMedicamento', resource: 'AplicacaoMedicamento', path: '/aplicacoes-medicamento', offline: true },
  { name: 'EventoSanitario', resource: 'EventoSanitario', path: '/eventos-sanitarios', offline: true },
  { name: 'ManejoTecnicoRebanho', resource: 'ManejoTecnicoRebanho', path: '/manejos-tecnico-rebanho', offline: true },
  { name: 'BebedouroHistorico', resource: 'BebedouroHistorico', path: '/bebedouros-historico', offline: false },
  { name: 'BebedouroSanidade', resource: 'BebedouroSanidade', path: '/bebedouros-sanidade', offline: false },
  { name: 'BebedouroAlerta', resource: 'BebedouroAlerta', path: '/bebedouros-alertas', offline: false },
];

const portTemplate = (ent) => `/**
 * Porta nativa de ${ent.name} (P5.5).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = '${ent.resource}';
const CAMINHO = '${ent.path}';
${ent.offline ? `export const ENTIDADE_OFFLINE = '${ent.name}';` : ''}

const ctx = (operation) => ({ operation, resource: RESOURCE });

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? \`?limit=\${encodeURIComponent(String(limite))}\` : '';
    return nativeRequest(\`\${CAMINHO}\${qs}\`, { autenticado: true }, ctx('list${ent.name}'));
  },

  filter: async (criterio, ordenacao, limite) => {
    void ordenacao;
    const lista = await operacoesNativas.list(undefined, limite);
    const arr = Array.isArray(lista) ? lista : [];
    return arr.filter((item) =>
      Object.entries(criterio || {}).every(([campo, valor]) => item?.[campo] === valor)
    );
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('create${ent.name}')),

  update: (id, dados) =>
    nativeRequest(
      \`\${CAMINHO}/\${encodeURIComponent(id)}\`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('update${ent.name}')
    ),

  delete: (id) =>
    nativeRequest(
      \`\${CAMINHO}/\${encodeURIComponent(id)}\`,
      { method: 'DELETE', autenticado: true },
      ctx('delete${ent.name}')
    ),
${ent.bulk ? `
  bulkCreate: (registros) =>
    nativeRequest(
      \`\${CAMINHO}/bulk\`,
      { method: 'POST', body: { registros }, autenticado: true },
      ctx('bulkCreate${ent.name}')
    ),` : ''}
});

export const ${ent.name.charAt(0).toLowerCase() + ent.name.slice(1)}Port = ${
  ent.offline
    ? `offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
    })
  : operacoesNativas`
    : 'operacoesNativas'
};
`;

for (const ent of ENTITIES) {
  const dirName = ent.path.slice(1).replace(/-/g, '-');
  const folder = join(ROOT, 'src/apis', dirName);
  mkdirSync(folder, { recursive: true });
  const fileName = ent.name.charAt(0).toLowerCase() + ent.name.slice(1) + 'NativePort.js';
  writeFileSync(join(folder, fileName), portTemplate(ent));
}

// Registro anexo + referencias
mkdirSync(join(ROOT, 'src/apis/registros-anexo'), { recursive: true });
writeFileSync(
  join(ROOT, 'src/apis/registros-anexo/registroAnexoNativePort.js'),
  `import { nativeRequest } from '../_core/nativeHttpClient.js';
const CAMINHO = '/registros-anexo';
const ctx = (operation) => ({ operation, resource: 'RegistroAnexo' });
export const registroAnexoPort = Object.freeze({
  filter: (criterio) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(criterio || {})) {
      if (v != null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    return nativeRequest(\`\${CAMINHO}\${qs ? \`?\${qs}\` : ''}\`, { autenticado: true }, ctx('filterRegistroAnexo'));
  },
  create: (dados) => nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createRegistroAnexo')),
  delete: (id) => nativeRequest(\`\${CAMINHO}/\${encodeURIComponent(id)}\`, { method: 'DELETE', autenticado: true }, ctx('deleteRegistroAnexo')),
});
`
);

mkdirSync(join(ROOT, 'src/apis/referencias'), { recursive: true });
writeFileSync(
  join(ROOT, 'src/apis/referencias/referenciasNativePort.js'),
  `import { nativeRequest } from '../_core/nativeHttpClient.js';
export const sincronizarReferenciasNativas = (payload) =>
  nativeRequest('/referencias/sincronizar', { method: 'POST', body: payload, autenticado: true }, {
    operation: 'sincronizarReferencias',
    resource: 'Referencias',
  });
`
);

console.log('Scaffolded native ports.');
