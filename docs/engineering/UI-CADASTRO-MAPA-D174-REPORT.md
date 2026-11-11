# UI-CADASTRO-MAPA-D174 — relatório

**Fatia:** Cadastro de Áreas, Pontos e Linhas no motor Base1 (D-PROD-174).
**Tipo:** tela (UI) e organização das ações. Sem migration, rota nova, página nova, mudança de regra ou de envio ao servidor.
**Pedido do proprietário (2026-11-11):** "Já aproveite e já ajuste também para cadastro de áreas, etc", no mesmo pedido de deixar campos, listagem, escolha e formatação iguais ao motor Base1.

## Antes e depois

| Peça | Antes | Depois |
|---|---|---|
| Lista | barra própria (Desenhar no Mapa, Selecionar no Mapa, Usar GPS, Importar áreas, ⚙), abas largas, grade antiga com funil em cada coluna e "⋮" em cada linha | tela do motor: abas no desenho do motor, "+ Novo", faixa de filtros, grade e cards, seleção, Excluir, rodapé |
| Ações de criação | botões na barra | "+ Novo" desenha a área ou a linha, ou marca o ponto; GPS, seleção no mapa, importação e cadastro em lote em "Mais opções" |
| Ações em lote das áreas | "Ações (n)" com Definir setor, Definir cor, Reatribuir códigos | as mesmas, em "Mais opções", ativas com área selecionada, na janela do motor (`B1Janela`) |
| Editar detalhes | painel lateral (Sheet) | registro do motor: campos travados, "Editar" libera, Salvar/Cancelar na barra, ‹ › entre registros |
| Editar geometria | "⋮ › Editar Área/Posição/Traçado" | "Mais opções › Editar no mapa" (ou "posição" ou "traçado") no registro |
| Campos da Área | rótulo em cima, caixas e listas do shadcn | campos e listas do motor (`B1Field`, `B1Select`), na mesma ordem |
| Listas do Ponto e da Linha | Select do shadcn | lista do motor, pelo adaptador `SelectDoMotor` |

## Peças

| Arquivo | O que faz |
|---|---|
| `src/pages/MapaCadastro.jsx` | abas e uma tela do motor por aba; desenho, importação, seleção no mapa, pontos em lote, exclusões (mesmas regras, mensagens e invalidações) |
| `src/components/mapa/cadastro/TelaCadastroMapa.jsx` | tela de uma aba: motor de lista completa, grade, registro com o formulário e as ações de "Mais opções" |
| `src/components/mapa/cadastro/colunasCadastroMapa.js` | colunas e regras de leitura das três abas (vindas das tabelas antigas), com a junção do ponto com a suplementação e o bebedouro |
| `src/components/mapa/cadastro/AcoesEmLoteAreas.jsx` | setor, cor e códigos das áreas selecionadas, na janela do motor |
| `src/components/cadastro/base1/SelectDoMotor.jsx` | adaptador: a interface do Select do shadcn desenhada com o `B1Select`; "Selecione…" vira o campo vazio |
| `FormularioArea.jsx`, `FormularioPonto.jsx`, `FormularioLinha.jsx` | `layout="registro"`: sem cabeçalho nem botões próprios, `id` para a barra do motor, campos travados em leitura; avisam a barra enquanto salvam |
| `LancField.jsx` | dentro de um `fieldset` desabilitado mostra o campo travado (cadeado), como o `B1Field` |

**Removidos, sem uso:** `TabelaAreasGeo.jsx`, `TabelaPontosGeo.jsx`, `TabelaLinhasGeo.jsx` e `ConfiguracaoColunasMapaDialog.jsx`.

## Verificação

- `npm run test:smoke`: 200 arquivos e 2.449 testes, todos passando.
  - Novo: `cadastroMapaMotor.test.jsx`, com a tela, o adaptador de lista e a junção dos pontos.
  - O caso de `importarAreasDialog.test.jsx` sobre a barra das áreas passa a abrir "Importar áreas" em "Mais opções".
  - O teste de criação manual da área (`formularioAreaCriacaoManual.test.jsx`) continua passando: mesmos campos, mesma ordem, mesmo envio.
- Gates de integridade de imports, independência do motor, fechamento de fontes, escopo e tipos: passam. A dívida de tipos caiu, porque as tabelas antigas saíram.
- Navegador (Chromium, backend falso só de leitura), 1366 px e 390 px:
  - lista das três abas, "Mais opções" e registro em leitura e em edição de Área, Ponto e Linha;
  - listas de escolha abertas;
  - nenhum erro de página.

## Evidências

`docs/engineering/evidencias/cadastro-mapa-d174/`:

- `cadastro-lista-antes-depois.png`: a lista antes e depois;
- `cadastro-areas-mais-opcoes.png`: as ações da aba Áreas em "Mais opções";
- `cadastro-area-registro.png`: registro da área em edição;
- `cadastro-ponto-linha-registro.png`: ponto em leitura (travado) e linha em edição;
- `cadastro-celular.png`: celular, com a lista em cards, "Mais opções" e a aba Pontos.
