# MAIKE — Permissões de ponta a ponta (relatório da missão)

Branch `claude/permissoes-ponta-a-ponta`, base `main` 8fd09dff (PR #197 já mergeada).
Sem migration, sem DDL, sem escrita remota. A decisão fica registrada **neste relatório**,
não no `DECISIONS.md`, porque a PR #198 está aberta e mexe nesse arquivo. A conciliação
(próximo `D-PROD-…`) é feita depois do merge dela.

## 1. O problema, em uma frase

A tela **Permissões** gravava a linha `Permissao`, mas:

- **nenhuma** rota de negócio a consultava. O bloqueio existia só no navegador.
- No navegador, ele abria por padrão:
  - conta sem registro, ou falha de leitura, virava `is_admin: true`;
  - tela sem linha era liberada;
  - o Mapa Geral olhava o módulo errado.

## 2. Hipóteses do pedido × o que foi reproduzido

| # | Hipótese | Veredito | Prova |
|---|---|---|---|
| 1 | `permissions.js`: registro `null` → tudo liberado; tela sem linha → liberada | **Bug confirmado** | `PERM-F1` falha na main |
| 2 | `permissaoMinimaNativa` dá `is_admin: true` a quem não tem registro | **Bug confirmado** (escalonamento de privilégio no menu e nas telas) | `PERM-F2` "operador sem registro" e "falha ao ler" falham na main |
| 3 | `Layout`: fallback no erro + bloqueio heurístico pelo texto do botão | **Confirmado**. A heurística era o ÚNICO bloqueio de ação fora do mapa e não pega ícone, modal, atalho nem chamada direta | Testes HTTP (`permissoesAutorizacao`): 8 falham na main |
| 4 | `MapaGeral`: cache separado de 5 min, `role === 'admin'` e outra leitura | **Confirmado, e pior que o descrito**. (a) `canAccessPage(…, 'pecuaria')`: o módulo real é `mapa`, então o operador com o mapa liberado recebia **todas** as permissões do mapa desligadas. (b) `role` nunca é preenchido no login nativo. (c) Nada era relido | `mapaGeral.test.js` (PERM-MG1 e fonte), `PERM-F2` revalidação |
| 5 | Formulário e telas | **Correto por design.** O alias `adm-permissoes → adm-usuarios`, os toggles e o payload estão coerentes. O módulo novo entra com linhas restritas (tudo `false`). `Usuarios.jsx` e `Permissoes.jsx` são funções distintas. Nada reescrito | `usuariosPermissoesSplit.test.jsx` (já existente, verde) |
| 6 | Backend: só o cadastro de Permissões exige admin | **Confirmado**: nenhuma rota de negócio respeitava a permissão de ação | 8 testes RED HTTP na main |

## 3. Regra única (servidor = fonte; navegador = espelho)

Arquivo `backend/src/shared/auth/autorizacaoTela.js`; o espelho no navegador é `src/lib/permissions.js` mais `permissaoEfetiva`.

Toda leitura vem do banco a cada requisição. Nada vem do token, do corpo ou do navegador.

1. Conta inativa ou inexistente → **nada**.
2. **Administrador da fazenda** (`Usuario.papel_tenant = 'administrador'`) → tudo, com ou sem linha `Permissao`.
3. Linha `Permissao` da **própria conta**, achada pelo vínculo canônico `cliente_id + user_email = login`:
   - `is_admin = true` → todas as telas e ações. É a concessão "acesso total" do formulário.
     **Não** dá autoridade de administrador da fazenda: Usuários, Permissões e Configurações seguem exigindo o papel (`TENANT_ADMIN_REQUIRED`).
   - Senão, a ação passa só com: módulo concedido **E** linha da tela com `visualizar === true` **E** a ação `=== true`.
4. Ação do Mapa Geral: a tela `pec-mapa-geral` precisa estar visível, e a chave do mapa não pode estar `false`. Chave ausente = ligada, a mesma regra do formulário (`normalizeMapaGeralPermissions`).
5. Sem linha, sem módulo, sem tela, ação ausente ou falha de leitura → **negado**.

A negação é um `preHandler` Fastify, que roda depois da validação e **antes** de qualquer escrita. Ela devolve `403 ACAO_NAO_PERMITIDA` com detalhes `{tela, acao}` ou `{tela, mapa}`.

No navegador, a mensagem mostrada é: "Você não tem permissão para esta ação. Nada foi gravado. Peça ao administrador da fazenda…".

### Semântica dos campos (retrocompatível, sem alterar registros)

| Campo | Significa | Não significa |
|---|---|---|
| `Usuario.papel_tenant` | autoridade de administrador da fazenda (contas, permissões, cancelamentos, ativação) | — |
| `Permissao.is_admin` | concessão explícita de todas as telas, ações e menu mobile | papel de administrador |
| `modulos_permitidos`, `permissoes_telas`, `mapa_geral_permissoes` | concessões do operador | nada é liberado fora delas |

Nenhum registro existente foi alterado. Uma linha sem uma tela agora **nega** essa tela (antes liberava).

Na produção (leitura apenas), o operador tem só o Mapa Geral com "visualizar" e todas as ações de lote desligadas. Depois deste PR ele vê o mapa **com** as camadas de visualização que tem ligadas; antes via todas desligadas, por causa do bug do módulo. Ele continua sem ações de lote, que é exatamente o que está configurado.

O administrador real não tem linha e continua com tudo.

## 4. Matriz antes/depois

### HTTP: backend, requisição direta

| Caso | Antes (main) | Depois |
|---|---|---|
| Operador **sem linha**: POST/PATCH/DELETE `/lotes`, correção de entrada, comandos do mapa, áreas, importação, pontos e linhas | 2xx (grava) | **403**, nada gravado (lotes, eventos, partidas, movimentações, áreas, auditoria, snapshots contados) |
| Config real do dono (só ver o mapa): todos os comandos de manejo | 2xx | **403** |
| `mover_lotes` ligado: transferência; abate, pesagem e morte | tudo passa | transferência passa; os outros **403** |
| `renomear_lotes`: PATCH só `nome` / PATCH com outro campo | passa / passa | passa / **403** |
| `pec-lotes` com `novo`, `editar`, `excluir` isolados | tudo passa | só a ação concedida passa |
| `visualizar` false, módulo ausente ou tela sem linha | passa | **403** |
| Revogação salva | só no próximo login, e mesmo assim só na tela | **próxima requisição** já nega |
| Admin real sem linha | passa | passa (nenhum 403) |
| Linha `is_admin` (não admin real): telas / PATCH `/permissoes` | passa / 403 | passa / **403 TENANT_ADMIN_REQUIRED** |
| Linha de **outro tenant** com o mesmo login | — | não concede nada (403) |
| Sem token | 401 | 401 |

### Navegador

| Caso | Antes | Depois |
|---|---|---|
| Conta sem registro | menu inteiro (`is_admin: true` inventado) | nenhuma tela; aviso "Sua conta ainda não tem telas liberadas…" sem laço de redirecionamento |
| Falha ao ler permissões | tudo liberado | nada liberado (ou o último valor do servidor, se houver cache da própria conta) |
| URL colada ou refresh em tela negada | a página montava, depois abria o diálogo | a página **não monta**; aparece o aviso ou o redirecionamento para a primeira tela liberada |
| Admin real | tudo | tudo |
| `role: 'admin'` / `is_admin` forjado no usuário local | `role` liberava o mapa inteiro | ignorados: vale só `administrador_fazenda`, que vem do `/auth/contexto` |
| Mapa Geral do operador | módulo `pecuaria`, então tudo desligado | módulo `mapa`, então valem as chaves concedidas |
| Mudança salva | só depois de logout ou de 5 min sem foco | evento de gravação na mesma aba; foco, `online` e a cada 60 s (Layout) / 30 s de validade (mapa) nas outras sessões |
| Troca de conta na mesma máquina | cache global `permissoes` com todas as linhas | cache **por login**, só a linha da própria conta, apagado no logout; uma linha de outro login no cache é descartada |
| Offline | lista global em cache | o último valor dado **pelo servidor** à própria conta; nunca amplia nada; nenhuma fila de privilégio |

## 5. O que mudou

### Backend

- `shared/auth/autorizacaoTela.js` (novo): `carregarAutorizacao`, `telaPermite`, `mapaPermite`, `porTela`, `porMapa`, `autorizar`, `chaveMapaDoTipo`.
- `errorCodes.js`: `ACAO_NAO_PERMITIDA` (403).
- Guardas (`preHandler`):
  - **Lotes**:
    - POST → `novo`;
    - PATCH → `editar`, ou só os campos de nome com `renomear_lotes`;
    - DELETE → `excluir`;
    - correção de entrada (R1) → `editar`.
  - **Comandos do mapa e do ledger**:
    - manejo-lote, manejo-rebanho e baixa-rebanho → a chave derivada do `tipo`;
    - junção → `juntar_lotes`;
    - POST genérico de movimentação → a chave do tipo, ou o mapa com `salvar`;
    - transferência do ledger → `mover_lotes`.
  - **Mapa Cadastro**:
    - áreas: POST → `novo`, PATCH → `editar`;
    - importação de áreas → `importar`;
    - pontos de referência: POST → `novo`, PATCH → `editar`, DELETE → `excluir`;
    - linhas geográficas: POST → `novo`, PATCH → `editar`.
  - **Permissões e Usuários**: já exigiam o administrador real no service (inalterado). Cancelamento e ativação do ledger: idem.

### Frontend

- `lib/permissions.js`: fail-closed. `null` → `false`; tela sem linha → `false`; comparação estrita `=== true`.
- `services/sessionService.js`:
  - `permissaoMinimaNativa` foi **removida**;
  - novos: `loginDoUsuario`, `permissaoEfetiva`, `carregarPermissaoEfetiva` (cache por login), `EVENTO_PERMISSOES_ATUALIZADAS` e `avisarPermissoesAtualizadas`;
  - o logout limpa o cache de permissões.
- `Layout.jsx`:
  - usa a permissão efetiva;
  - revalida em foco, `visibilitychange`, `online`, a cada 60 s e no evento de gravação;
  - não monta a página negada;
  - mostra o aviso de conta sem telas.
  - A heurística de clique continua só como **conveniência visual**. A segurança é o 403 do servidor.
- `MapaGeral.jsx`: uma leitura só (`['permissao-efetiva', login, papel]`), papel real, módulo `mapa`, revalidação.
- `Permissoes.jsx`: depois de salvar ou remover, invalida e avisa a sessão.
- `ApiError.js` e `nativeHttpClient.js`: `ACAO_NAO_PERMITIDA` passa a ter código e mensagem.

### Testes

- **Novos**:
  - `backend/tests/permissoesAutorizacao.test.mjs`: 11 testes HTTP com PostgreSQL descartável;
  - `tests/smoke/permissoesPontaAPonta.test.jsx`: 14 testes jsdom no shell real.
- **Atualizados** (codificavam o fail-open antigo):
  - `usuariosPermissoesSplit` ("sem linha" agora é negado);
  - `menuAdministradorFazenda` ADM-02;
  - `mapaGeral` MG3/MG4 (réplica pelo papel real, PERM-MG1 forjado, fonte com `mapa`);
  - `appShell` (navega como administrador real);
  - harness E2E (`USUARIO` com `login` e `administrador_fazenda`).
- **Fixtures do backend**:
  - `criarTenant` cria por padrão a linha `is_admin` do operador de teste. Os testes de negócio existentes seguem iguais.
  - `semPermissao: true` vale para os testes que contam inventário ou criam a própria linha: SQL Editor, inicialização do tenant, catálogo global, admin MAIKE, autorização de Usuários e SR-02.
  - O cenário R5 T2 ("usuário comum com permissão de manejo") recebe a concessão explícita.

## 6. RED → GREEN

| Suite | main (RED) | branch (GREEN) |
|---|---|---|
| `permissoesAutorizacao` (HTTP/PG) | 8 falham / 3 passam (os casos positivos) | 11/11 |
| `permissoesPontaAPonta` (jsdom) | 11 falham / 3 passam (os casos positivos) | 14/14 |

## 7. Inventário: o que AINDA não tem guarda de tela (próximo slice, sem PR nova antes do merge)

Todas estas rotas exigem token e tenant (R11). O que falta nelas é a checagem de **tela/ação**:

- **Cadastros do menu Manejo** — `setores`, `categorias-manejo`, `bebedouros`:
  - existe cadastro rápido de setor a partir da área (`CadastroRapidoSetor`) e de bebedouro a partir do mapa (`FormularioPonto`);
  - guardar só pela tela do cadastro bloquearia esse uso legítimo;
  - falta uma decisão de política: qual tela autoriza o cadastro rápido.
- **Suplementação** — `suplementacao-lotes` (com o bulk) e `suplementacao-eventos`:
  - as chaves do mapa são `lancar_suplementacao` e `movimentar_depositos`;
  - as telas `sup-*` também gravam nessas rotas, então é preciso mapear quem chama.
- **Tarefas** — `lancamentos-tarefa`, `tipos-tarefa` e `grupos-atividade`, ligadas a `visualizar_tarefas` e `gt-lancamentos`.
- `mapGeography/configuracao-icones` (PUT).
- **Empresa** — `empresas`: há partes que já exigem admin; falta revisar o resto.
- **Rotas fora do produto atual** (estoque, produtos, fornecedores, marcas, unidades, locais, notas, sanidade, medicamentos, movimentações pecuárias, manejos técnicos, anexos, arquivos e referências):
  - não têm tela no menu atual (`config/mapa-manejo-scope.json`);
  - um operador sem tela não as alcança pela interface, mas uma requisição direta ainda grava;
  - plano: negar a operadores (só o administrador real) ou mapear para uma tela.
- **Leitura e exportação** (GET): a tela não é checada no servidor. Isso inclui GET de lotes, movimentações e áreas.
  - Hoje o isolamento é só por tenant: um operador sem a tela lê os dados da própria fazenda por chamada direta.
  - Plano: `porTela(..., 'visualizar')` nos GET das telas protegidas, mais `exportar` onde houver exportação no servidor. Hoje a exportação é gerada no navegador, a partir da leitura.

## 8. Compatibilidade e riscos

- **Operador com linha incompleta** (módulo sem as linhas de tela, por exemplo de registros antigos): perde a tela até o administrador salvar a configuração. É o comportamento pedido: ausência não libera nada.
  - Os registros novos já saem completos do formulário.
  - Na produção há 1 operador, com a configuração completa.
- **Conta nova sem linha**: vê o aviso e não recebe privilégio. O administrador configura em Usuários.
- **Seleção de responsável em Tarefas** (`FormularioTarefaMapa`): contas sem linha deixam de aparecer como responsáveis. Coerente com elas não terem a tela.
- **Offline**: a revogação feita enquanto o aparelho está offline só chega ao reconectar. O cache só guarda o último valor do servidor e nunca é ampliado. Qualquer gravação feita depois passa pelo 403 do servidor.
- **Custo**: 1 leitura `Usuario` + 1 `Permissao` por requisição guardada (por chave única).
- Migrations e DDL: **nenhuma**. Escrita remota (Supabase, Vercel): **zero**.
