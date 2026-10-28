# MAIKE — Plano de separação entre padrões internos e Configurações Gerais

**Data:** 28/10/2026 (atualizado R3 catálogo global, 28/10/2026)
**Repositório:** `maikelimaadm-stack/MAIKE`  
**Referência consultada:** `main` em `1590655fc9ef080d8d178d270c22f9ec3c50fe1d` (merge PR #125).  
**Natureza:** documento de planejamento — **sem alterações de código de produto** nesta fase.

## 1. Decisão do produto

Existem dois domínios diferentes e eles não devem mais coexistir como se fossem um cadastro editável pelo cliente.

1. **Administração interna do produto MAIKE (catálogo global):** ícones oficiais, subícones, categorias visuais, tipos de entidade/POI e regras **MISTO** de exibição no mapa. Compartilhado entre **todos** os clientes; **sem** `cliente_id` no modelo final; **sem** edição por administrador de fazenda. Governança operacional via **painel interno exclusivo** do produto. **Fonte de verdade definitiva:** metadados e regras no **PostgreSQL do Supabase**; bytes visuais no **Supabase Storage** com revisão/versionamento — **não** o repositório GitHub como autoridade de alterações operacionais do catálogo. GitHub permanece autoridade de código, contratos, migrations e seed inicial. Alterações normais de imagem, associação, ordem, cor, categoria ou regra pelo painel **não** exigem commit/deploy quando o contrato já suporta a mudança; mudanças estruturais de schema/lógica ainda exigem migration e deploy. Política explícita contra substituição silenciosa de arquivos no mesmo caminho cacheado (CDN/cache).
2. **Configurações Gerais do cliente (autoridade do administrador do tenant):** preferências que o produto realmente permitir ajustar para a operação do cliente; dados isolados por `cliente_id` quando o comportamento for por cliente, por `empresa_id` somente se uma regra de negócio exigir distinção entre fazendas, e por usuário quando o ajuste for pessoal. **Não copiar** cadastro de Empresas, Permissões **nem** o catálogo global.

**Catálogo global e configurações do cliente são conceitos distintos** mesmo quando o produto os exibe na área administrativa. O painel interno do catálogo **não** deve ser projetado como submenu de um tenant.

## 2. Verificação concreta da main

- `src/pages/ConfiguracoesGerais.jsx` mostra `GerenciadorIcones` e um cartão explicativo de `MISTO`. Não há um módulo completo de preferências gerais do cliente nessa página.
- `src/components/configuracoes/GerenciadorIcones.jsx` permite criar, editar e desativar ícones, com upload e seleção de `tipo_entidade`/`categoria`; `TIPOS_ENTIDADE` e `CATEGORIAS_SUGERIDAS` estão **hardcoded** — não são SSOT aprovada.
- `backend/prisma/schema.prisma` define `ConfiguracaoIcone` com `cliente_id` obrigatório, `empresa_id` opcional, `tipo_entidade`, `categoria`, URLs de imagem, `categorias_misto` JSON e status. Coleção **por tenant**, não catálogo global.
- `backend/src/modules/mapGeography/configuracaoIconeRepository.js` lista ícones filtrando `cliente_id`. Chaves React Query com segmento `global` **não** alteram o escopo do banco.
- `PontoReferencia.configuracao_icone_id` é referência opaca (sem FK composta); URLs copiadas no registro — migrar ids/imagens sem auditoria pode quebrar pontos e caches.
- `src/components/mapa/useMapRenderer.jsx`: categoria única → ícone por categoria; várias categorias → registros `categoria=MISTO` com `categorias_misto` cobrindo todas, escolhendo regra válida mais específica (menor lista). Comportamento a **preservar** até migração testada. Referências a Google Maps podem coexistir; MapLibre paralelo não presume integração.
- `src/lib/menuConfig.js` tem entrada própria `adm-configuracoes` → `ConfiguracoesGerais`.
- Trabalho paralelo de mapa pode existir sem PR visível; ausência de PR **não** autoriza tocar mapa nesta branch.

## 3. Bloqueio de colisão — já em vigor

**Não executar o prompt anterior** `PROMPT_CURSOR_MAIKE_PR126_CONFIGURACOES_GERAIS_MOTORBASE1_SEM_COLISAO_MAPA.md`; ele moderniza o atual editor de ícones, que agora pertence a outro roadmap.

Enquanto o trabalho paralelo em mapa estiver ativo:

- NÃO abrir nova PR para **implementação** de Configurações Gerais ou catálogo global; uma PR/slice ativa por vez conforme regra de governança.
- NÃO modificar `src/pages/ConfiguracoesGerais.jsx`, `src/components/configuracoes/GerenciadorIcones.jsx`, `src/apis/mapa/**`, `src/services/configuracaoIconeService.js`, `backend/src/modules/mapGeography/**`, `src/components/mapa/**`, `src/pages/MapaGeral.jsx`, `src/pages/MapaCadastro.jsx`, `src/lib/menuConfig.js`, `src/pages.config.js`, `config/mapa-manejo-scope.json`, `backend/prisma/schema.prisma` ou migrations enquanto houver possibilidade de colisão.
- Não renomear, apagar, resetar, remapear nem migrar `ConfiguracaoIcone`, IDs de pontos de interesse ou caches de mapa.
- Somente planejamento e governança em `docs/` nesta fase (PR #126); após merge do mapa, preflight atualizado e diff real antes de nova PR de código.

## 4. Matriz de possíveis preferências do cliente — propostas, não funcionalidades existentes

| Grupo sugerido | Exemplo de opção candidata | Escopo possível | Dependência | Estado |
|---|---|---|---|---|
| Apresentação | Formato de exibição de datas, se houver necessidade real | Cliente ou usuário, a decidir | Auditoria do uso de datas | A definir com produto |
| Apresentação | Densidade de visualização / preferência de tabela | Usuário, se não for preferência local já atendida | Identificar armazenamento atual da UI | A definir com produto |
| Operação | Unidade de exibição de pesos/áreas, **sem alterar a unidade persistida** | Cliente ou empresa, a decidir | Auditoria de cálculos e relatórios | Adiar até contrato do domínio |
| Operação | Padrões operacionais de telas, se houver requisito real | Cliente ou empresa | Definir consumidor concreto e comportamento | A definir com produto |
| Notificações | Preferências de alertas, quando existir funcionalidade real | Cliente ou usuário | Infraestrutura de eventos/alertas | Fora da primeira entrega |

**Não criar telas vazias, campos fictícios nem tabelas genéricas sem um caso de uso concreto.** A primeira implementação dependerá de uma lista fechada de preferências e de seus consumidores reais.

## 5. Arquitetura a definir antes de implementar

### 5.1 Catálogo global (slice futura — Supabase)

Modelo conceitual (nomes físicos sujeitos a auditoria):

| Entidade | Responsabilidade |
|---|---|
| Tipo entidade/ícone | Código estável, rótulo, estado, ordem |
| Categoria visual | Tipo compatível, código estável, rótulo, estado, ordem |
| Ícone oficial | ID estável, tipo/categoria, refs Storage (principal + subícone), cor/fallback, revisão |
| Asset Storage | Caminho, revisão, MIME, dimensões, hash, publicação, auditoria |
| Regra MISTO | IDs das categorias participantes, ícone resultado, especificidade, empate determinístico, fallback |

**MISTO:** regra de exibição visual governada; distinta do sexo `Misto` em lotes; participantes por ID estável; validação de duplicatas/sobreposição/empates.

**Segurança:** autorização produto MAIKE no backend + dados; leitura tenant separada da escrita; upload Storage restrito; sem service-role no frontend.

**Offline/mobile:** manifest/revisão de catálogo, cache versionado, pré-download, invalidação pós-sync, fallback e rollback.

**Migração legado:** inventário `(cliente_id, id ConfiguracaoIcone) → id global`; reversibilidade; **não** executar nesta PR.

### 5.2 Preferências do cliente

- Inventário read-only de opções em `localStorage`, `Layout`, serviços, cadastros, relatórios e mapa.
- Por preferência aprovada: chave estável, tipo, default, escopo, leitura/escrita, validação, consumidor, offline, auditoria, permissões.
- SSOT backend; tenant **sempre** do token; escrita só a roles comprovadas no backend.
- Não duplicar Empresas nem Permissões.

## 6. Ordem operacional

**Agora (PR #126, governança em docs):** D-PROD-57 corrigida (Supabase DB + Storage + painel interno); matriz de preferências; proteção mapa; PR **DRAFT** para auditoria — **sem** implementação.

**Após merge manual desta PR:** aguardar conclusão/merge do trabalho paralelo de mapa (**não** inferir término pela ausência de PR).

**Preflight pós-mapa:** SHA `main`, CI, PRs abertas, diffs e contratos alterados pelo mapa.

**Auditoria autorizada pelo proprietário:** leitura Supabase (schema, RLS/grants, Storage, auth, migrações) e Vercel — **sem** alterar ambientes na fase documental.

**Slice isolada — catálogo global:** PostgreSQL + Storage + painel interno + testes (leitura global, isolamento escrita, IDs, MISTO, cache, offline, migração).

**Slice independente — Configurações Gerais do cliente:** somente após lista fechada de preferências com consumidores; ordem relativa ao catálogo **revalidada** por dependências (não presumida).

## 7. Critérios mínimos de aceitação futura

- Nenhum diff em diretórios/contratos congelados do mapa na PR de Configurações Gerais.
- Nenhuma capacidade do administrador de fazenda de alterar catálogo global; painel interno produto MAIKE exclusivo.
- Catálogo servido de Supabase; assets em Storage com revisão; operações normais sem deploy Git quando contrato permitir.
- Configurações persistentes com escopo claro; tenant do token; backend nega escrita não autorizada (teste).
- Testes: leitura global, MISTO, compatibilidade IDs legados, invalidação cache, offline onde aplicável.
- Build, smoke, backend e `verify:all` conforme ambiente; E2E/visual PENDING quando não executados.

## 8. Estado

**READY FOR PRODUCT DEFINITION — NOT READY FOR IMPLEMENTATION.**

Nenhuma alteração de Supabase, Storage, mapa ou telas de Configurações Gerais foi executada nesta missão de governança (inclui correção R3 documental).
