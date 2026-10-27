#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

const PORTS = [
  { entity: 'Empresa', port: 'empresaPort', path: '/empresas', dir: 'empresa' },
  { entity: 'Permissao', port: 'permissaoPort', path: '/permissoes', dir: 'permissoes' },
  { entity: 'Fornecedor', port: 'fornecedorPort', path: '/fornecedores', dir: 'fornecedores' },
  { entity: 'CategoriaManejo', port: 'categoriaManejoPort', path: '/categorias-manejo', dir: 'categorias-manejo' },
  { entity: 'Bebedouro', port: 'bebedouroPort', path: '/bebedouros', dir: 'bebedouros' },
  { entity: 'PontoSuplementacao', port: 'pontoSuplementacaoPort', path: '/pontos-suplementacao', dir: 'pontos-suplementacao' },
  { entity: 'EstoqueLoteNota', port: 'estoqueLoteNotaPort', path: '/estoque-lotes-nota', dir: 'estoque-lotes-nota', filter: true },
  { entity: 'MovimentacaoEstoque', port: 'movimentacaoEstoquePort', path: '/movimentacoes-estoque', dir: 'movimentacoes-estoque', listLimit: true },
];

for (const p of PORTS) {
  const file = `${p.port.replace('Port', 'NativePort')}.js`;
  const filterLine = p.filter
    ? `  filter: (criterio) =>
    nativeRequest(\`\${CAMINHO}\${queryDeFiltro(criterio)}\`, { autenticado: true }, ctx('filter${p.entity}')),`
    : '';
  const listBody = p.listLimit
    ? `  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? \`?limit=\${encodeURIComponent(String(limite))}\` : '';
    return nativeRequest(\`\${CAMINHO}\${qs}\`, { autenticado: true }, ctx('list${p.entity}'));
  },`
    : `  list: (ordenacao) => {
    void ordenacao;
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('list${p.entity}'));
  },`;

  const content = `/**
 * Porta nativa de ${p.entity} (P5.4).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = '${p.entity}';
const CAMINHO = '${p.path}';
export const ENTIDADE_OFFLINE = '${p.entity}';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const queryDeFiltro = (criterio) => {
  if (!criterio || typeof criterio !== 'object') return '';
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(criterio)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const texto = params.toString();
  return texto ? \`?\${texto}\` : '';
};

const operacoesNativas = Object.freeze({
${listBody}
${filterLine}
  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('create${p.entity}')),
  update: (id, dados) =>
    nativeRequest(
      \`\${CAMINHO}/\${encodeURIComponent(id)}\`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('update${p.entity}')
    ),
  delete: (id) =>
    nativeRequest(
      \`\${CAMINHO}/\${encodeURIComponent(id)}\`,
      { method: 'DELETE', autenticado: true },
      ctx('delete${p.entity}')
    ),
});

export const ${p.port} = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
    })
  : operacoesNativas;
`;
  const dir = join(ROOT, 'src/apis', p.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content);
}

console.log('Native ports OK');
