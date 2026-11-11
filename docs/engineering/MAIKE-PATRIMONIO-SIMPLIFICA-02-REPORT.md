# MAIKE-PATRIMONIO-SIMPLIFICA-02 — Produtos aceitos em qualquer unidade, sem Área e Localização, Família fora da tela

Decisão: **D-PROD-169** ([`DECISIONS.md`](./DECISIONS.md)). Base: `origin/main` `87e8a5ca`, o merge da PR #239 (SIMPLIFICA-01, D-PROD-162).
Branch: `claude/new-session-abgn5w` · PR #241, junto do registro da release da D-PROD-162.

## 1. Pedido do proprietário (2026-11-11)

Depois de testar em produção o Patrimônio da D-PROD-162, o proprietário pediu:

1. Escolher o Produto do tanque em qualquer unidade de medida, mantendo a regra da baixa exata.
2. Tirar a Área e a Localização do cadastro do Bem.
3. Excluir o cadastro de Família, deixando as famílias pré-cadastradas e trocando o nome. O Tipo passa a ter listagem, renomear e excluir.

Respostas às perguntas da missão: "Família some", "Tipo de bem + Tipo", "Junta tudo numa PR só".

Situação de produção antes da missão:
- 1 família criada à mão (código `TESTE`), 1 tipo e 0 bens.
- Os 2 Produtos do cliente estavam em SACO e, por isso, não podiam ser aceitos no tanque.

## 2. O que mudou

| Área | Mudança |
|---|---|
| Tanque e abastecimento | Produtos aceitos em L, KG ou SACO. O abastecimento usa a unidade de **estoque** do Produto: L para L, kg para KG e para SACO (o SACO guarda estoque em kg). `AbastecimentoBem.unidade` continua `L`/`KG`, e a capacidade do tanque só é conferida para L. A tela mostra o texto novo da regra. |
| Cadastro do Bem | Saem Área e Localização de todas as telas de Bens. As colunas ficam no banco, sem apagar nada. "Natureza" passa a se chamar **"Tipo de bem"** (lista fixa). A Família sai da tela. O **"Tipo"** é filtrado pelo Tipo de bem e tem "+ Novo tipo". |
| Gerenciar tipos | O diálogo do "⋯" de Bens lista, renomeia (com versão) e exclui. Tipo sem bem: exclusão física, auditada. Tipo em uso: 409 `PATRIMONIO_TIPO_EM_USO` ("Este tipo está em uso por N bem(ns)…"). |
| Catálogo | A garantia automática e idempotente (`garantirCatalogoPadrao`) entra no lugar do botão "Instalar catálogo padrão". Cria as 6 famílias padrão, agora com `OUTROS`. Os tipos padrão nascem só junto da própria família, então um tipo excluído não volta. Tipos novos vão para a família padrão da natureza; os tipos de famílias antigas continuam valendo. |
| API | Rotas novas ou mudadas:<br>• `POST /patrimonio-tipos` recebe `natureza`.<br>• `DELETE /patrimonio-tipos/:id?versao=N`.<br>• `GET /patrimonio-tipos?natureza=`.<br>• o Bem sem `familia_id`: o backend deriva a família do tipo e recusa natureza divergente com 422 `BEM_TIPO_NATUREZA_INCOMPATIVEL`.<br><br>Rotas que saem (404):<br>• criar, editar e ler família;<br>• opções de famílias e de áreas. |
| Banco | **Nenhuma migration.** |

## 3. Revisão adversarial (3 lentes) e correções

Quatro achados, todos menores, foram verificados e corrigidos com teste RED→GREEN:

1. O instalador explícito `POST /patrimonio-catalogo-padrao` recriava tipos padrão que o usuário tinha excluído. Agora segue a mesma regra da garantia.
2. Esc no campo "Renomear" fechava o diálogo inteiro. Agora cancela só a renomeação.
3. Renomear ou excluir um tipo não relia a lista nem o detalhe de Bens. Agora relê.
4. Ficaram rotas de leitura de família e de áreas sem consumidor. Saíram.

O teste E2E no celular achou mais um defeito, já corrigido: o filtro do "Gerenciar tipos" abria fora do diálogo.

## 4. Provas (código final, local)

| Verificação | Resultado |
|---|---|
| Backend completo (PG 16 local, banco novo, `FRONTEND_ORIGINS` como na CI) | 126 arquivos, 1611 testes: **1606 pass, 0 fail**, 5 todo |
| Teste novo `patrimonioSimplifica02.test.mjs` | RED 13/13 falhando no código antigo; GREEN no código novo |
| Smoke | 189 arquivos, **2354/2354** |
| `test:gates` | **739/739** |
| `npm run gate:*` (30 gates) | todos EXIT=0 |
| `npm run build` | EXIT=0 |
| E2E real `e2e-patrimonio-simplifica-real.mjs` (1280/820/390 px) | **42/42**, EXIT=0, sem rolagem horizontal |
| E2E real `e2e-abastecimentos-real.mjs` (1280/820/390 px) | **33/33**, EXIT=0 (L com capacidade, KG e SACO em kg, baixa e estorno exatos) |
| ESLint nos arquivos alterados | 0 problemas |

## 5. Riscos e observações

- **Família de nome igual:** se uma família criada à mão tiver o nome de uma família padrão, a padrão nasce como "<Nome> (padrão)". A família `TESTE` de produção não colide com nenhuma.
- **Escrita no primeiro acesso:** a garantia do catálogo grava no banco na primeira leitura de tipos de cada cliente, sob a trava do catálogo, com auditoria atribuída ao usuário da requisição.
- **Código de erro sem rota:** `FAMILIA_PATRIMONIAL_NAO_ENCONTRADA` continua no catálogo de erros por contrato (`config/modelobase1-pecuario.json`), mas nenhuma rota o devolve mais.
- **Teste de CORS no ambiente local:** `transporteNativo.test.mjs` precisa de `FRONTEND_ORIGINS=http://localhost:5173`, como a CI define. Sem essa variável, 3 testes falham sem relação com esta missão.

## 6. Situação

`MIGRATION = NÃO` · release = merge + deploy · CI e merge registrados no corpo da PR #241.

## 7. Integração com o motor Base1 (PR #240) e janelas do motor (D-PROD-170)

A pedido do proprietário, a PR #241 entrou no modelo Base1 antes do merge.

- **Merge da `main` com a #240 (D-PROD-164 a D-PROD-168) e a #242 (D-PROD-163, SVG):** a decisão desta missão passa de D-PROD-163 a **D-PROD-169** (código, testes, scripts E2E e documentos). A lista de Bens ganha a faixa de filtros, a tabela e o rodapé do design. O registro ganha o cartão de identificação (Nº, Nome, Código de frota, Situação, Tipo de bem e Tipo), as abas em pílula e os campos do design. Conflitos resolvidos: `FormularioBem` (os campos novos no cartão do design), `FormularioTipo` (densidade do motor) e `FormularioFamilia` (continua removido).
- **Janelas (D-PROD-170):** "Gerenciar tipos", prévia e cancelamento do abastecimento e consumo do bem passam à janela do motor (`B1Janela`). Antes e depois em `evidencias/patrimonio-simplifica-02/`:
  - `gerenciar-tipos-antes-depois.png`: fundo quente; ✕ no cabeçalho; pesquisa em pílula; "+ Novo tipo" como o "+ Novo"; Renomear e Excluir como na barra;
  - `novo-tipo-antes-depois.png`: os campos do "+ Novo tipo" voltam ao desenho do formulário (antes, sem caixa e com a seta solta);
  - `gerenciar-tipos-celular.png`: 390 px; as ações descem para baixo do nome e a folha das escolhas continua dentro da janela.
- **Conferido no navegador** (1366 e 390 px; backend falso, só leitura): lista, registro em leitura e em edição (Identificação e Operação com tanques), "Gerenciar tipos" e "+ Novo tipo".
- **Testes:** `b1Janela.test.jsx` (novo) e um caso novo em `bensGerenciarTipos.test.jsx`. Os testes de Patrimônio passam sem mudança de regra: Bens, tipos, tanques, abastecimentos, cancelamento e permissões.
