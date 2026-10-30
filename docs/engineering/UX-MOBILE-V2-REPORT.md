# UX-MOBILE-V2 — celular e chrome Base1 conforme o protótipo "MAIKE App v2"

**Decisão:** D-PROD-86 · **Branch:** `claude/mobile-shell-base1-v2`
**Fonte:** handoff do Claude Design (`MAIKE App v2.dc.html` + conversa de 29–30/10/2026).

## O que mudou

| Área | Arquivos |
|---|---|
| Shell do celular: cabeçalho, barra de vidro, Módulos, Trocar empresa | `src/Layout.jsx`, `src/components/navigation/MobileModulesView.jsx`, `src/lib/mobileShellContext.jsx`, `src/styles/maike-mobile-shell.css` |
| Folha de baixo única (62/92%, alça, fundo preto) | `src/components/common/MobileSheet.jsx` |
| Ações só com ícone; raio na faixa; Filtros; pesquisa recolhível sem fechar sozinha; navegação de registro; resumo oculto na edição; carga automática de 200 | `CadastroListaChrome.jsx`, `CadastroBase1Screen.jsx` |
| Filtrar por campo | `FiltroPorCampo.jsx`, `filtroPorCampoBus.js`, `CadastroBase1Grade.jsx` |
| Filtro de coluna: condição ao vivo, bloqueio de zero, folha no celular | `CadastroColunaFiltro.jsx`, `cadastroColunaFiltroLogic.js` |
| Menu da coluna na folha (celular) | `Base1Grid.jsx` |
| Seletor na folha com pesquisa e teto de 100 | `MgSelect.jsx` |
| Toque: multisseleção e toque duplo | `selectClick.js`, `Base1Grid.jsx`, `Base1Cards.jsx` |
| Cards se alinham sozinhos abaixo do desktop | `Base1Cards.jsx`, CSS |
| Avisos no topo, centralizados | `MaikeSonnerToaster.jsx` |

Removido: `src/components/common/BackButton.jsx` (só o Layout usava).

## Diferenças em relação ao protótipo

- **Tablet:** continua com o cabeçalho e o menu de módulos do desktop. O rail lateral do protótipo não foi feito.
- **Mapas:** Mapa Geral e Cadastro do Mapa do protótipo são simulações. Os mapas reais (MapLibre) não foram tocados.
- **Menu do usuário (Configurações, Sair):** continua acessível no celular, pelo avatar à direita do cabeçalho. No protótipo ele não aparece.
- **Botão Filtros:** não mostra a quantidade de filtros. Ele fica verde quando há filtro ativo, porque o chrome só sabe se há filtro, não quantos.
- **Editar/Duplicar:** somem quando não há exatamente 1 selecionado (comportamento do protótipo). No desktop, continuam apagados, como no sistema.
- **Voltar do registro:** volta para a grade de tabela, como antes (`exitRecordView`).

## Verificação

- `npm run test:smoke`: 1003 testes passam, incluindo os 13 novos de `tests/smoke/mobileShellV2.test.jsx`. `tests/smoke/appShell.test.jsx` foi ajustado: o gatilho agora é "Módulos", e é preciso escolher o módulo antes da tela.
- `npm run verify:all`: todas as etapas passam, exceto `test:backend`, que exige `DATABASE_URL` com PostgreSQL. O ambiente da sessão não tem banco, e esse teste roda no CI.
- **Conferência visual a 390×844** (Chromium com toque e dados sintéticos; não é o app autenticado): `docs/engineering/evidencias/ux-mobile-v2/`.
  - Cards com multisseleção, Mais opções, registro com navegação, edição.
  - Filtrar por campo, filtro de coluna, Módulos, telas do módulo, Trocar empresa.
- **Não conferido na tela:**
  - seletor (`MgSelect`) na folha: a tela usada não tem select;
  - tablet;
  - aparelho real.

## Checklist manual (aparelho real)

- [ ] Pesquisa abre e não fecha sozinha; fecha ao tocar fora.
- [ ] Puxar a alça de uma folha: sobe para 92%, desce para 62%, fecha.
- [ ] Toque duplo abre o registro; toque simples marca vários.
- [ ] Rolar até o fim carrega mais 200 (lista grande).
- [ ] Campos de 16px não dão zoom no iPhone.
