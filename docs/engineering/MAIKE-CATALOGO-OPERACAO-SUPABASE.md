# Runbook — operação do catálogo global de ícones no Supabase

**Decisão:** D-PROD-69 (sobre D-PROD-57/60/62) · **Público:** proprietário do produto MAIKE.

O MAIKE **não tem tela de gerenciamento de ícones**. Os ícones oficiais são dados globais do produto:

- os metadados ficam no Supabase PostgreSQL (`Catalogo*`);
- os bytes ficam no Supabase Storage, no bucket `maike-catalogo-global`;
- os clientes só leem o que está publicado. Nenhum tenant edita ícone, nem o admin do tenant.

> **Proibido sem aprovação separada e por escrito do proprietário:** aplicar migration, criar bucket, registrar
> operador, enviar imagem ou alterar variáveis na **produção**. Este runbook vale primeiro para **local** e
> **staging**. Nunca cole segredos em chat, issue, commit ou log.

## 0. Ambientes

| Ambiente | Banco | Storage | Quem executa |
|---|---|---|---|
| Local | PostgreSQL local (`DATABASE_URL`) | adaptador em memória (sem `SUPABASE_URL`) ou Storage falso | desenvolvedor |
| Staging | projeto Supabase de staging | bucket de staging | proprietário |
| Produção | projeto Supabase de produção | bucket de produção | proprietário, **só com aprovação separada** |

## 1. Preflight — migrations, grants e RLS

1. Confirme que o backend implantado contém a PR do catálogo e a migration `20261029200000_categoria_manejo_vinculo_catalogo`.
   **Ordem obrigatória:** aplicar as migrations **antes** de publicar um backend que grave
   `catalogo_categoria_visual_id`. Sem a coluna, o salvamento de Categoria de Manejo falha.
2. Faça backup ou confirme o PITR no painel do Supabase (Database → Backups).
3. Aplique as migrations com a conexão direta, nunca pelo pooler:
   `MIGRATION_DATABASE_URL=… npm run deploy:migrate`. O build da Vercel **não** roda migrations.
4. Confira com estas consultas, todas só de leitura:
   ```sql
   SELECT migration_name, finished_at FROM "_prisma_migrations"
    WHERE migration_name LIKE '20261028250%' OR migration_name LIKE '20261029%' ORDER BY 1;
   SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('CatalogoMeta','CatalogoTipoEntidade','CatalogoCategoriaVisual','CatalogoAsset',
                      'CatalogoIcone','CatalogoRegraMisto','CatalogoRegraMistoCategoria',
                      'OperadorProdutoMaike','AuditoriaCatalogoGlobal');
   SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_name = 'CatalogoIcone' AND grantee IN ('anon','authenticated');  -- deve vir vazio
   SELECT column_name FROM information_schema.columns
    WHERE table_name = 'CategoriaManejo' AND column_name = 'catalogo_categoria_visual_id';
   ```
   Resultado esperado:
   - as migrations do catálogo e as de 29/10 aplicadas;
   - as 9 tabelas com RLS;
   - nenhum grant para `anon` ou `authenticated`;
   - a coluna nova existindo.

## 2. Bucket do Storage

1. Crie o bucket `maike-catalogo-global` pelo painel. A referência está em `scripts/catalogo/bootstrap-storage-bucket.sql`.
   - Ele é **público só para leitura**. A escrita é feita apenas pelo backend com `service_role`.
   - Não crie políticas de upload para `anon` ou `authenticated`.
2. As variáveis do backend são só do servidor, nunca `VITE_`:
   - `SUPABASE_URL`;
   - `SUPABASE_SERVICE_ROLE_KEY`;
   - opcionalmente `CATALOGO_STORAGE_BUCKET`.

   Em `NODE_ENV=production`, o upload exige o adaptador ao vivo e recusa configuração parcial.
3. **Publicação e visibilidade:**
   - a API só lista ícones `publicado` e ativos;
   - o objeto de um rascunho fica no bucket público, num caminho imprevisível
     (`v{rev}/{sha16}-{uuid}.ext`) que não é listado por nenhuma API.

   Por isso, **envie só imagens oficiais**: não use o bucket para testes ou rascunhos de arte.

## 3. Operador de produto

Só um `OperadorProdutoMaike` ativo escreve no catálogo. `Permissao.is_admin` do tenant recebe 403.

```bash
BOOTSTRAP_OPERADOR_CLIENTE_ID=… BOOTSTRAP_OPERADOR_USUARIO_ID=… BOOTSTRAP_OPERADOR_CONFIRM=sim \
  node scripts/catalogo/bootstrap-operador-produto.mjs
```

Em produção, o script recusa a execução sem `BOOTSTRAP_OPERADOR_ALLOW_PRODUCTION=sim`. Esse passo exige a aprovação separada.

## 4. Cadastrar ou trocar imagens já prontas (CLI local)

As imagens são **as do proprietário, sem alteração**: não redimensionar, não converter, não otimizar.

- Formatos aceitos: PNG, JPEG, WebP e GIF. **SVG é recusado.**
- Limite de 512 KB por arquivo (`CATALOGO_ASSET_MAX_BYTES`).
- O MIME é conferido pelos bytes reais.

Manifesto de exemplo. Os nomes e caminhos são **fictícios**:

```json
{
  "tipo": { "codigo": "lote", "nome": "Lote" },
  "itens": [
    { "categoria": { "codigo": "bezerro", "nome": "Bezerro" }, "imagem": "./icones/bezerro.png", "cor_fallback": "#16a34a" },
    { "categoria": { "codigo": "novilha", "nome": "Novilha" }, "imagem": "./icones/novilha.webp" }
  ]
}
```

Os caminhos são relativos ao arquivo do manifesto. O tipo precisa ser `lote`: é o único que a Categoria de Manejo aceita.

```bash
# 1) Validação local apenas (sem rede):
node scripts/catalogo/importar-icones.mjs --manifesto ./icones/manifesto.json
```

```bash
# 2) Plano contra o ambiente, ainda sem escrever (DRY-RUN):
MAIKE_API_URL=https://<backend-staging> MAIKE_OPERADOR_LOGIN=… MAIKE_OPERADOR_SENHA=… \
  node scripts/catalogo/importar-icones.mjs --manifesto ./icones/manifesto.json
```

```bash
# 3) Aplicar (exige confirmar o host):
MAIKE_API_URL=https://<backend-staging> MAIKE_OPERADOR_LOGIN=… MAIKE_OPERADOR_SENHA=… \
  node scripts/catalogo/importar-icones.mjs --manifesto ./icones/manifesto.json --apply --confirmar=<backend-staging>
```

O que a CLI faz (`scripts/catalogo/importarIconesLib.mjs`):

- **Rotas usadas:** só a API admin existente. Herda a validação real de imagem, o CAS por `revisao_esperada`
  (relido antes de cada escrita), a auditoria (`AuditoriaCatalogoGlobal`) e a compensação de objeto órfão no Storage.
  Não faz INSERT direto nem grava binário no SQL.
- **Idempotência:** compara o `sha256` do arquivo com o do ícone publicado (tirado da URL versionada).
  Imagem igual não gera nenhuma escrita. Imagem nova faz upload de um asset novo e `PATCH` no **mesmo id de ícone**.
  Categoria nova cria categoria, ícone em rascunho e depois o publica.
- **Falha parcial:** um 409 (outro operador alterou o catálogo) ou qualquer erro interrompe a execução. Reexecutar é seguro.
  Os possíveis restos são inertes:
  - um asset registrado e não usado;
  - um ícone em rascunho, invisível para os clientes.
- **Sem URL pública** (ambiente sem `SUPABASE_URL`): a CLI não consegue comparar o hash e reenvia a imagem.
  O id continua o mesmo.

**Trocar um ícone no futuro:** basta trocar o arquivo e reaplicar o manifesto. Não precisa de commit nem de deploy.

- O id do ícone e o da categoria se mantêm.
- O asset, a URL versionada e a revisão mudam.
- Os clientes passam a ver a imagem nova em até 60 s (cache de leitura do frontend).

**Precedência:** com mais de um ícone publicado para a mesma categoria, vence o de maior `revisao`; no empate, vence o menor `id`.
Para evitar ambiguidade, mantenha **um** ícone publicado por categoria. Para desativar os demais, use
`POST /catalogo-global/admin/icones/:id/desativar`; o registro e o asset são preservados.

## 5. Associar à Categoria de Manejo

- **Pelo usuário do tenant:** no formulário **Categoria de Manejo**, o campo "Ícone oficial (catálogo MAIKE)" lista
  só as categorias publicadas do tipo `lote`. Não há upload, cor ou edição de imagem. O backend valida que a categoria
  existe, está ativa e é do tipo `lote` (422 `CATALOGO_GLOBAL_INVALID` se não for).
- **Lote:** não guarda ícone. O `FormularioLote` resolve
  `categoria_manejo_id` → `catalogo_categoria_visual_id` → ícone publicado, ao criar, editar e duplicar.
  Sem vínculo, mostra um aviso discreto e salva normalmente.
- Associação em massa por SQL **não** é o caminho recomendado. Se for indispensável, rode-a em transação, filtrando por
  `cliente_id`, e só com ids que a consulta de categorias ativas do tipo `lote` retornar.

## 6. Validação em staging

1. `GET /catalogo-global/manifest` (com JWT) responde 200 com a `revisao` atual.
2. `GET /catalogo-global/icones` traz os ícones publicados, com `asset_principal_url` acessível no navegador.
3. Um usuário comum e um admin de tenant recebem 403 em `POST /catalogo-global/admin/icones/:id/publicar`.
4. Editar uma Categoria de Manejo, escolher a categoria oficial, salvar e reabrir: o vínculo persiste.
5. Lote novo com essa categoria: a prévia mostra o ícone. Salvar, reabrir e duplicar: a prévia continua certa.
   Repetir no desktop e no celular.
6. Categoria de Manejo sem vínculo: o lote salva e mostra o aviso.

## 7. Backup, rollback e checklist

- [ ] Backup/PITR confirmado antes de qualquer migration.
- [ ] Grants e RLS conferidos (§1).
- [ ] Bucket sem política de escrita pública (§2).
- [ ] Operador de produto registrado só para o usuário do proprietário.
- [ ] Dry-run revisado antes de `--apply`.
- [ ] Produção: **aprovação separada do proprietário** registrada.

**Rollback:**

- **Ícone:** desativar (`/admin/icones/:id/desativar`). Os lotes voltam ao aviso, sem erro.
- **Vínculo:** a Categoria de Manejo volta para "SEM VÍNCULO".
- **Schema:** reversão manual, documentada no topo de
  `backend/prisma/migrations/20261029200000_categoria_manejo_vinculo_catalogo/migration.sql`.
  Antes, volte o backend para uma versão que não use a coluna.
- As tabelas do catálogo podem ficar vazias e inertes, sem efeito nos cadastros.
