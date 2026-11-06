# MAIKE — Editar Informação da posição no Mapa Geral (D-PROD-139)

Pedido do proprietário, com o documento `MAIKE_PROXIMO_SLICE_EDITAR_INFORMACOES_LOTE_MAPA.md`:
- tornar funcional o botão **Editar Informação** do Detalhes do Lote no controle por posições;
- editar dados administrativos da posição (o grupo na área) sem tocar no cadastro de entrada (`Lote`), no saldo, nos movimentos nem nos eventos.

## 1. Antes

- No ledger, `abrirRenomear` só mostrava "No controle por posições, renomeie o lote no Cadastro de Lotes. Nada foi gravado."
- O caminho legado (`RenomearLoteForm`) grava `Lote` e cria a movimentação "Renomear Lote". Não foi reaproveitado.

## 2. Contrato de campos

| Situação | Campos | Onde muda |
|---|---|---|
| editável na posição | `nome`, `identificador_nome`, `identificador_sigla`, `identificador_cor` | este comando |
| somente leitura | `numero_lote`, origem/linhagem, `lote_entrada_id`, raça, sistema produtivo, data de entrada | Cadastro de Lotes (entrada) |
| exige comando de manejo | `quantidade_cabecas`, área, `peso_medio_kg`, `categoria`, `sexo`, categoria de manejo, `chave_identidade` | Mover, Pesar, Mudar Categoria (motor do ledger) |

A identidade da posição (`chave_identidade` = origem + categoria + sexo + categoria de manejo, `rebanhoLedgerNucleo.js` `chaveIdentidade`) não usa nome nem identificação. Por isso a edição não funde, não separa e não reencontra outra posição.

## 3. O que mudou

- **Backend:**
  - `backend/src/modules/rebanhoLedger/rebanhoLedgerInformacao.js` (novo): `editarInformacaoPosicao`.
  - `rebanhoLedgerRoutes.js`: `PATCH /rebanho/posicoes/:id/informacoes`, `porMapa('renomear_lotes')`, schema fechado.
  - `errorCodes.js`: `POSICAO_REBANHO_VAZIA` (409).
- **Regras do servidor:**
  - tenant do auth_context;
  - a posição precisa ser do tenant e da empresa informada, senão 404 igual nos dois casos;
  - ledger ativo (409);
  - posição com cabeças (409);
  - `FOR UPDATE` na posição e AuditLog na mesma transação (`comando: 'editar_informacao_posicao'`, `campos_alterados`);
  - sem mudança: 200 sem gravar.
- **Frontend:**
  - `src/components/lotes/EditarInformacaoPosicaoForm.jsx` (novo), `src/services/informacaoPosicaoService.js` (novo);
  - camadas de API (`movimentacaoMapaNativePort`, `movimentacoesMapaApi`, `lotesApi`, `loteManejoService`);
  - `DetalhesLote.jsx` (só o bloco Editar Informação).
  - No ledger, o diálogo escolhe o grupo (com a área) e mostra duas partes: editável e somente leitura. Envia só o que mudou.
  - Ao salvar:
    - atualiza o cache `['mapa-lotes']`;
    - invalida as consultas de lotes;
    - dispara `atualizar-mapa` (`cacheKeys: ['lotes']`), que relê do servidor.
  - Erro → mensagem do código, formulário aberto, sem sucesso falso.
  - Sem ledger: igual a antes.
- **Docs:** D-PROD-139; `MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md` (matriz e rota → guarda).

## 4. RED → GREEN

- **Backend** — `backend/tests/posicaoEditarInformacao.test.mjs` (PostgreSQL 16 local descartável, HTTP real, prova por persistência):
  - RED na main `4c530979`: 27 de 29 falham porque a rota não existe. Os 2 que passam são `cliente`/`cliente_id`, recusados pela barreira global em qualquer rota.
  - GREEN: 31/31 (com os casos da revisão).
  - **Casos:**
    - posição A editada, posição B e `Lote` intactos;
    - nenhum evento, partida, peso ou movimentação novo;
    - AuditLog com antes/depois e ator;
    - novo GET devolve o gravado.
  - **Normalização:** vazio vira null; sem mudança, nada é gravado nem auditado.
  - **Estrutura do rebanho:**
    - nomes repetidos: não funde;
    - múltiplas categorias da mesma entrada (após Mudança de Categoria): só a alvo muda;
    - posições reunidas (Junção): linhagem, saldo e identidade intactos.
  - **Depois de editar:** transferir e pesar funcionam; o destino novo leva o nome editado.
  - **Interação documentada:** renomear no Cadastro de Lotes ainda propaga.
  - **Corpo proibido → 400 e nada gravado:** `quantidade_cabecas`, `area_id`, `peso_medio_kg`, `categoria`, `sexo`, `categoria_manejo_id`, `categoria_manejo_nome`, `chave_identidade`, `lote_entrada_id`, `linhagem`, `numero_lote`, `id`, `cliente_id`, `cliente`, `empresa`, `is_admin`.
  - **Nome inválido:** vazio, só espaços ou corpo sem campo → 400.
  - **Autorização:** sem `renomear_lotes` → 403 e zero mutações; `is_admin` e admin real → 200.
  - **Isolamento:**
    - outro tenant → 404, nos dois tenants nada muda;
    - outra empresa sem ledger → 409; com ledger → 404;
    - id inexistente → 404.
  - **Outros:** zero cabeças → 409 `POSICAO_REBANHO_VAZIA`; sem token → 401.
- **UI** — `tests/smoke/editarInformacaoPosicao.test.jsx` (DetalhesLote e formulário REAIS; mocks só na borda):
  - RED na main: 8 de 10 falham. Os 2 que passam são controles: sem permissão o botão não aparece; no modo legado continua o formulário antigo.
  - GREEN: 12/12 (com os casos da revisão).
  - **Casos:**
    - escolha do grupo com a área;
    - partes editável e somente leitura;
    - envia só o alterado (`{empresa_id, nome, identificador_sigla}`);
    - nenhuma escrita de manejo ou cadastro (`atualizarLote`, `criarMovimentacao`...);
    - cache do mapa mostra o gravado, inclusive depois do novo GET;
    - `atualizar-mapa` disparado;
    - identificação apagada → null;
    - sem mudança não envia;
    - nome vazio não envia;
    - 403/404/409 com mensagem precisa e sem sucesso falso;
    - falha de rede com mensagem de resultado não confirmado;
    - sem `renomear_lotes` não há botão;
    - modo legado inalterado.

Evidências locais:
- `scratchpad/l1-red.txt`, `l1-green.txt`, `l1-ui-red.txt`, `l1-ui-green.txt`, `l1-verify.txt`.

## 5. Revisão adversarial

Dois revisores independentes (backend/segurança e UI/regressão), com um cético por achado tentando refutar com reprodução (PG descartável e vitest). Cinco achados confirmados, todos de severidade baixa e todos nos commits deste slice; todos corrigidos com teste:

| Achado | Correção | Teste |
|---|---|---|
| NUL, TAB ou surrogate isolado → 500 em vez de 400 | `normalizar` recusa caractere de controle e texto mal formado (400) | backend › "caractere de controle..." |
| Limite medido em unidades UTF-16 recusava valor que cabe na coluna (ex.: 20 emojis na sigla) | servidor confia no `maxLength` do schema (conta caracteres); tela mede em code points e só valida o campo alterado | backend › "tamanho conta caracteres"; UI › "valor longo já gravado..." |
| AuditLog "antes" sem área e entrada (registrava mudança inexistente) | o "antes" é relido com as mesmas relações, sob o `FOR UPDATE` | backend › caso principal (antes e depois com a área) |
| Identificador gravado em minúsculas, ao contrário do Cadastro (o filtro e o selo do mapa comparam exato) | identificador_nome/sigla em maiúsculas, no servidor e na tela; campo não mexido não é regravado | UI › "minúsculas vai em maiúsculas"; backend › caso principal |
| Invalidar as consultas do mapa logo após salvar podia repor o IndexedDB antigo (< 60 s) | a posição devolvida atualiza as duas consultas do mapa (`mapa-lotes` e `mapa-cache/lotes`); quem relê do servidor é o refresh forçado do `atualizar-mapa` | UI › caso principal (IndexedDB antigo não sobrescreve) |

## 6. Riscos residuais

- **Cadastro sobrescreve o mapa:** renomear no Cadastro de Lotes sobrescreve o nome ou a identificação editados no mapa para todas as posições da entrada. É o comportamento de propagação já existente (`loteService`); está documentado e tem teste.
- **Transferência leva o nome:** transferir para uma área sem a mesma identidade cria a posição de destino com o nome editado. Se a identidade já existe no destino, prevalece o nome do destino.
- **Revogação em voo:** a permissão é conferida no preHandler, como nos demais comandos do ledger. Um pedido já em voo quando a permissão é revogada pode concluir. É o risco aceito da R2 §9.2.
- **Sem controle de versão:** duas pessoas editando ao mesmo tempo → vale a última gravação, serializada pelo `FOR UPDATE`. O AuditLog guarda as duas.
- **Só online:** sem conexão, a tela mostra que não foi possível confirmar; repetir é seguro.
- **IndexedDB:** o cache local do mapa é regravado pelo refresh forçado; se esse refresh falhar, o mapa aberto já mostra o valor novo, mas uma reabertura offline antes do próximo refresh pode mostrar o antigo.
- **TAB no nome:** agora é recusado (400), como nos anexos; antes do slice não havia este endpoint.

## 7. Fora do escopo

- Não toca nos arquivos das PRs abertas #209 (`src/lib/maplibre/lifecycle.js`), #210 e #211 (`src/styles/mk-superficie.css`, `src/components/cadastro/base1/Base1Ui.jsx`).
- Sem migration, sem escrita remota.
