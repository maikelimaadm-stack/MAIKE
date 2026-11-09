# UI-DETALHES-LOTE-V8 — relatório

**Fatia:** UI-DETALHES-LOTE-V8: diálogo "Detalhes do Lote" mobile-first, com as vistas Resumo, Lote e Lista.
**Tipo:** visual (UI). Não tem migration, domínio, rota, página, config nem dependência nova.
**Branch:** `claude/new-session-w7315b`. O prompt pedia `claude/ui-detalhes-lote-v8`, mas a sessão só pode publicar na branch designada.
**Fonte da verdade:** `docs/design/detalhes-do-lote/detalhes-do-lote-v8.dc.html`, versionado nesta PR como evidência, junto com `support.js` e `image-slot.js`.

## Como foi feito

Foram 5 agentes em paralelo. Cada um era dono dos seus arquivos e todos seguiam um contrato único de interfaces. O contrato fixava as assinaturas do catálogo de dados (E), dos primitivos visuais (A) e do estado da aba Lotes (B). Cada agente fez um commit. A verificação foi feita uma vez só, no fim.

| Agente | Arquivos |
|---|---|
| A casca + menu | `DetalhesLote.jsx`, `detalhes-lote/PainelDetalhesLote.jsx`, `detalhes-lote/pecas.jsx`, `styles/mk-detalhes-lote.css`, `AcoesDoLote.jsx` (1 classe) |
| B controles | `detalhes-lote/useEstadoLotes.js`, `detalhes-lote/ControlesLotes.jsx`, `detalhes-lote/AbaLotes.jsx` |
| C Resumo + Lote | `detalhes-lote/LinhaLote.jsx`, `detalhes-lote/CartaoLote.jsx`, `detalhes-lote/VistaResumo.jsx`, `detalhes-lote/VistaLote.jsx` |
| D Lista + Tudo + Área | `detalhes-lote/VistaLista.jsx`, `detalhes-lote/ListaCompactaLotes.jsx`, `detalhes-lote/CartoesLoteTudo.jsx`, `detalhes-lote/AbaArea.jsx`, `InformacoesArea.jsx` |
| E dados + formato | `detalhes-lote/catalogo.js`, `suplementacao/ResumoSuplementacao.jsx` (só o modo "completo") |

A pasta `src/components/mapa/detalhes-lote/` é nova. O prompt só previa 1 arquivo novo, o CSS. Mesmo assim, o item 5 pede "componente próprio" para os controles e um catálogo de campos com interface própria, e nada disso cabia nos arquivos existentes sem misturar os donos. Nada entrou em `src/domain/**`.

`DetalhesLote.jsx` mantém intacta toda a lógica de manejo: mutations, comandos do ledger e todos os diálogos. Só mudou o conteúdo exibido, que agora é `PainelDetalhesLote` com o modelo de `montarModeloDetalhes`. Também ganhou a query das movimentações, que não bloqueia a abertura.

## Dados: só o que o sistema calcula hoje

- **UA e UA/ha:** a mesma regra de `MapaInsights.jsx` (1 UA = 450 kg PV). O hectare efetivo é `area_pastejada` quando for maior que 0; senão, `tamanho_hectares`.
- **Capacidade:** `capacidade_maxima` é a UA total da área, como em `MapaInsights.jsx`.
  - Capacidade (UA/ha) = `capacidade_maxima` ÷ ha.
  - % da capacidade = UA total ÷ `capacidade_maxima`.
  - O alerta de lotação aparece quando esse percentual passa de 100%.
- **Pesagem:** a posição do ledger não traz o histórico de pesos, e a fatia não pode criar rota. Por isso o histórico vem das movimentações `Pesagem` ativas, que já estão no cache do mapa (linhas com `posicao_id` e `peso_novo_kg`).
  - Desse histórico saem: Última, Intervalo (dias), Próxima (última + 60), Nº pesag., Peso na 1ª pesagem (kg) e Dias sem pesar.
  - Sem pesagem registrada, Dias sem pesar conta a partir da data de entrada.
  - **Origem (MEDIDO/DERIVADO) é inferida.** Vale MEDIDO quando o peso atual bate com a última Pesagem; senão, DERIVADO. O `PesoRebanho.medido` não chega ao front.
- **Alertas:** são só dois.
  - Pesagem atrasada: mais de 60 dias sem pesar. Âmbar, nível 2.
  - Intervalo curto: menos de 28 dias entre pesagens. Neutro, nível 1.
- **Situação:** "Atenção" quando há algum alerta de nível 2; senão, "Em dia".
- **Formato:** um helper único em `catalogo.js` (`fmtNum`, `fmtInt`, `fmtPct`, `fmtData`). Nunca põe unidade depois do número; a unidade vai no rótulo. Vazio aparece como "—".
- **O que não aparece:** GMD, @, preço, peso projetado, CV, custo em R$, consumo em g/kg PV, sanidade, capim, época, produção e sobra no cocho.

## Diferenças em relação ao mockup, e por quê

1. **Respiro de 12px** entre o menu e o primeiro card (o mockup tem 2–4px). É exigência explícita do prompt.
2. **Coluna "Valor do alerta (dias)".** No mockup o valor era "76 dias", com unidade depois do número, o que o prompt proíbe.
3. **Linha "N cab · peso 449,5"** do Resumo, da lista do Tudo e das categorias: mantida como no mockup, porque "cab" e "peso" funcionam como rótulos. As frases de alerta ("Faz 76 dias sem pesar") e o título "Suplementação (últimos 30 dias)" também são texto do mockup ou do prompt.
4. **Nome do lote na Lista.** Quebra em até 2 linhas e corta com reticências, com o nome inteiro no `title`. No mockup ficava em uma linha só e invadia a coluna vizinha quando o nome era longo; o dono reportou isso.
5. **Campo "Filtrar" em 12px.** Uma regra global do app força 16px em `button[role=combobox]` (para evitar o zoom do iOS em campo de digitação). Aqui o combobox é um botão, então a regra foi sobrescrita só dentro de `.mk-dl8`.
6. **Placeholder do ícone de categoria** com raio 4/8, para respeitar os raios 999/12/8/4; o mockup usava rx 9.
7. **Deslize lateral** só por toque. Com mouse, arrastar para selecionar texto trocaria a aba. O gesto também é ignorado dentro da tabela, que rola na horizontal.
8. **Acessibilidade** que o mockup não tinha:
   - Esc fecha o popup.
   - Setas, Home e End navegam pelas abas.
   - `aria-controls` no combobox.
9. **Atalho do Tudo para um lote.** Se o filtro de alerta ativo esconde o lote tocado, o filtro é limpo para abrir aquele lote.
10. **Ordenação por gravidade.** Segue o mockup: a gravidade conta também o nível 1. Dentro de "Em dia", um lote com Intervalo curto vem antes dos lotes sem alerta.

## Gates

A saída completa está no PR. Resumo:

- `npm run build`: passou.
- `npm run lint`: passou.
- `npm run gate:product-scope`: passou com contagens iguais à `main` (22 páginas, 35 entidades, 0 function(s), antes e depois).
- `npm run verify:all`: ver o PR.
- Tipos (catraca):
  - Arquivos novos com 0 erros de `tsc`.
  - `DetalhesLote.jsx` passou de 26 para 24 erros legados.
  - `ResumoSuplementacao.jsx` passou de 2 para 0.

## Screenshots

Ficam em `docs/engineering/evidencias/detalhes-lote-v8/`, em 390, 820 e 1280px:

- Lotes › Resumo
- Resumo com um lote aberto
- Lotes › Lote
- Lotes › Lista
- popup Filtrar aberto
- Tudo no celular (só 390)

Foram tirados com os componentes reais do app (diálogo, painel, ações, suplementação) e os dados de exemplo do mockup, numa página de teste local que não foi versionada. Os ícones de categoria aparecem como placeholder porque os dados de exemplo não têm configuração de ícone.

Conferências automáticas nos 3 tamanhos:

- O menu de abas fica na mesma posição em todas as abas e com o corpo rolado.
- Nada cobre o menu.
- Nenhuma palavra GMD, arroba ou @ aparece.
- Nenhum erro de página.

## O que NÃO foi feito

- **Nome do lote no título da folha de manejos:** não se aplica. O prompt proíbe botões de ação no card, então a folha só abre pelo botão do cabeçalho, sem lote. `MobileSheet.jsx` não foi alterado.
- **Origem do peso pelo `PesoRebanho.medido` real:** exige expor o campo no servidor, que está fora do escopo.
- **Histórico de pesagens que acompanha a mudança de área:** o histórico é lido por `posicao_id`, então uma posição criada numa mudança de área começa sem as pesagens da posição anterior.
- **Screenshots com dados de produção:** a verificação usou dados de exemplo, não o app logado.
