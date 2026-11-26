# Diário das atividades: Insumo por carga (D-PROD-334)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-334](./DECISIONS.md) · **Branch:** `feat/atividades-insumo` · **Migration:** nenhuma · **Backend:** sem mudança

## O que mudou

- A opção **Insumo** do serviço aberto (tela 05) abre a **Carga de insumo** (maquete 06) na MESMA janela. As outras seis opções continuam "Em breve".
- A tela tem o cabeçalho "Carga N" (a próxima do dia) e "Encher o <implemento>"; o alternador **Produto | Mistura**; por produto, o seletor real (paginado), o saldo e o local, a quantidade com a unidade do cadastro ao lado (só leitura); o horímetro opcional (um por carga); e o botão "Salvar carga" no rodapé.
- A palavra "jato" saiu de todo texto visível deste fluxo ("Carga" no lugar). O campo `jato` do fio não mudou.
- "Lançado hoje" mostra "Insumo · Carga N".

## Arquivos

- `src/lib/cargaInsumoRegras.js` (novo): `proximaCarga`, `tituloDaCarga`, `subDaCarga`, `marcadorDaCarga`, `lerCarga`, `apontamentoDeHoje`, `linhasDaCarga`, `localMaisCheio`.
- `src/components/lancamento-atividades/CargaDeInsumo.jsx` (novo): a tela, o envio em sequência ou em lote, o progresso da retentativa e a consulta.
- `src/components/lancamento-atividades/DiarioDasAtividades.jsx`: estado `insumoAberto`, título, seta "Voltar ao serviço" (`carga-voltar`) e o rodapé pelo portal.
- `src/lib/aberturaServicoRegras.js`: "Insumo · Carga N".
- `src/styles/cadastro-base1.css`: `.b1-carga-cab`, `.b1-carga-modo`, `.b1-carga-nota`, `.b1-carga-qtd`, `.b1-carga-un`, no fim da seção `.b1-aberto-*`.
- Testes: `tests/smoke/diarioDasAtividades.test.jsx` (bloco Insumo, 8 casos), `tests/smoke/aberturaServicoRegras.test.js` ("Carga 1"), `tests/smoke/cargaInsumoRegras.test.js` (novo).
- Documentação: `docs/engineering/DECISIONS.md` (D-PROD-334; marcador em D-PROD-334).

## Portões

- `npx eslint` nos arquivos alterados e novos: sem erros.
- `npx vitest run` nos testes relacionados (abertura, diário, campo por tipo, carga): 93 testes passam. Os testes do diário da máquina e da reforma também passam.
- `npm run gate:types`: passa (361 diagnósticos, teto 625; o baseline não foi regravado).
- `npx vite build`: passa.

## Limites e dúvidas

- **Mistura não é atômica** na sequência com apontamento de hoje; a retentativa é por progresso (D-PROD-334).
- **Sem conferência de salto** do horímetro da carga contra a máquina.
- **Produto com lote:** sem tela de lote; o servidor aplica o FEFO.
- **Unidade "SACO":** o estoque de sacos é em quilos (a regra atual `unidadeDoProduto` converte SACO para KG), então o rótulo é "kg". Não há rótulo "Sacos" nesta tela.
- **Atividade com áreas:** o `atividade_area_id` do pasto é achado por `area.id` (ou `area_id`) das áreas da atividade; confirmar com um dado real de atividade com várias áreas.
- **Sobra** (o que sobra no implemento) e a devolução ao estoque: fora do escopo.
