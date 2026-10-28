# MAIKE — Plano de separação entre padrões internos e Configurações Gerais

**Data:** 28/10/2026  
**Repositório:** `maikelimaadm-stack/MAIKE`  
**Referência consultada:** `main` em `1590655fc9ef080d8d178d270c22f9ec3c50fe1d` (merge PR #125).  
**Natureza:** documento de planejamento — **sem alterações de código de produto** nesta fase.

## 1. Decisão do produto

Existem dois domínios diferentes e eles não devem mais coexistir como se fossem um cadastro editável pelo cliente.

1. **Padrões internos do MAIKE (autoridade do produto):** ícones oficiais, categorias visuais padrão e tipos-padrão de pontos de interesse, como cocho, bebedouro etc. O operador da fazenda não cria e não altera esse catálogo. A versão será governada no código/repositório; se um catálogo compartilhado editável em runtime for necessário no futuro, o banco pode armazenar metadados globais com controle exclusivamente administrativo do produto. Decisão sobre armazenamento de arquivos (assets versionados ou objetos) deve obedecer às necessidades de offline/cache. Não adotar duplicação por `cliente_id` apenas para dar a todos os clientes o mesmo padrão.
2. **Configurações Gerais do cliente (autoridade do administrador do tenant):** preferências que o produto realmente permitir ajustar para a operação do cliente; dados isolados por `cliente_id` quando o comportamento for por cliente, por `empresa_id` somente se uma regra de negócio exigir distinção entre fazendas, e por usuário quando o ajuste for pessoal. **Não copiar** cadastro de Empresas nem Permissões.

**Padrões internos e configurações do cliente são conceitos distintos mesmo quando o produto os exibe na área administrativa.**

## 2. Verificação concreta da main

- `src/pages/ConfiguracoesGerais.jsx` mostra `GerenciadorIcones` e um cartão explicativo de `MISTO`. Não há um módulo completo de preferências gerais do cliente nessa página.
- `src/components/configuracoes/GerenciadorIcones.jsx` permite criar, editar e desativar ícones, com upload e seleção de `tipo_entidade`/`categoria`.
- `backend/prisma/schema.prisma` define `ConfiguracaoIcone` com `cliente_id` obrigatório, `empresa_id` opcional, `tipo_entidade`, `categoria`, URLs de imagem e status. Assim a coleção atual é **por tenant**, não catálogo global único.
- `backend/src/modules/mapGeography/configuracaoIconeRepository.js` lista ícones filtrando `cliente_id`. `PontoReferencia.configuracao_icone_id` é uma referência opaca existente; migrar ids sem auditoria pode quebrar pontos já cadastrados.
- `src/lib/menuConfig.js` tem entrada própria `adm-configuracoes` → `ConfiguracoesGerais`.
- GitHub não retornou PR aberta ao consultar; isso **não prova** ausência de branch local ou trabalho paralelo ainda não submetido. O usuário informou trabalho ativo em mapa, portanto a política de exclusão de arquivos continua válida.

## 3. Bloqueio de colisão — já em vigor

**Não executar o prompt anterior** `PROMPT_CURSOR_MAIKE_PR126_CONFIGURACOES_GERAIS_MOTORBASE1_SEM_COLISAO_MAPA.md`; ele moderniza o atual editor de ícones, que agora pertence a outro roadmap.

Enquanto o trabalho paralelo em mapa estiver ativo:

- NÃO abrir nova PR para **implementação** de Configurações Gerais; uma PR/slice ativa por vez conforme regra de governança.
- NÃO modificar `src/pages/ConfiguracoesGerais.jsx`, `src/components/configuracoes/GerenciadorIcones.jsx`, `src/apis/mapa/**`, `src/services/configuracaoIconeService.js`, `backend/src/modules/mapGeography/**`, `src/components/mapa/**`, `src/pages/MapaGeral.jsx`, `src/pages/MapaCadastro.jsx`, `src/lib/menuConfig.js`, `src/pages.config.js`, `config/mapa-manejo-scope.json`, `backend/prisma/schema.prisma` ou migrations enquanto houver possibilidade de colisão.
- Não renomear, apagar, resetar, remapear nem migrar `ConfiguracaoIcone`, IDs de pontos de interesse ou caches de mapa.
- Somente planejamento e governança em `docs/` nesta fase; após merge do mapa, fazer preflight atualizado e mapear o diff real antes de nova PR de código.

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

- Fazer inventário de opções realmente existentes hoje em `localStorage`, `Layout`, Serviços, cadastros, relatórios e mapa (somente leitura). Não transplantar opções sem dono.
- Para cada preferência aprovada: chave estável, nome, tipo, default, escopo, regra de leitura, regra de escrita, validação, consumidor real, comportamento offline, política de atualização, auditoria, permissões de leitura/escrita e estratégia de migração.
- SSOT backend para preferências compartilhadas persistidas no banco, com isolamento de tenant derivado do token **e nunca do body/query**; alterações pela API somente a administradores autorizados segundo regra comprovada em backend, não apenas menu/frontend.
- Preferências do usuário devem usar escopo de usuário, não afetar outros integrantes do tenant, e não vazar em sessões diferentes.
- Não duplicar funcionalidades do `Cadastro de Empresas` ou da tela `Permissões`.
- Catálogo de ícones é projeto próprio de sistema, coordenado com mapa, e será tratado em uma slice separada **após** a PR paralela de mapas, com plano de migração de IDs legados.

## 6. Ordem operacional

**Agora (governança em docs):** congelar o prompt PR #126 anterior; definir a matriz de preferências legítimas de cliente; registrar esta separação de responsabilidades (D-PROD-57); monitorar somente o status do mapa quando o usuário apresentar o relatório ou confirmar merge.

**Quando o trabalho paralelo do mapa terminar e tiver merge manual:** confirmar SHA `main`, CI exato do merge, PRs abertas e diff do mapa; só então escolher nova branch/PR única para Configurações Gerais sem colisão.

**Primeira PR após liberação:** modernizar Configurações Gerais **apenas para preferências aprovadas e com consumidores reais**, sem mexer no catálogo de ícones; criar backend/configuração e UI apenas quando a necessidade do cliente justificar persistência, com testes de isolamento e autorização.

**PR posterior coordenada com mapa:** criar catálogo global de ícones/tipos do MAIKE e migrar referências com compatibilidade. Essa atividade é separada de Configurações Gerais e requer testes de renderização, consulta, offline, cache e referências antigas.

## 7. Critérios mínimos de aceitação futura

- Nenhum diff em diretórios/contratos congelados do mapa na PR de Configurações Gerais.
- Nenhuma capacidade do usuário de alterar ícones globais.
- Configurações persistentes identificadas com escopo claro (`cliente`, `empresa` ou `usuario`), sem vazamento entre clientes.
- Acesso negado no backend com teste para sessão não autorizada; não inferir `is_admin` do frontend como autorização suficiente.
- Build, smoke, testes backend e `verify:all` conforme condições de ambiente; testes E2E/visual declarados PENDING quando não executados.
- Somente um PR DRAFT aberta; usuário faz merge manual após auditoria.

## 8. Estado

**READY FOR PRODUCT DEFINITION — NOT READY FOR IMPLEMENTATION.**

Nenhuma alteração de Supabase, mapa ou telas de Configurações Gerais foi executada nesta missão de governança.
