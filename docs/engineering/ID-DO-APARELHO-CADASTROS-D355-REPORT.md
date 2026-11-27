# Relatório: o código do aparelho em mais cadastros (D-PROD-355)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-355](./DECISIONS.md)

## Pedido

"Consegue ir resolvendo todos esses bugs sem parar?" Esta é a primeira pendência da sincronização: com o sinal fraco, a criação de setor, área, ponto de referência ou linha podia ficar em dobro. A auditoria do servidor (D2) confirmou o problema com um teste.

## O que mudou

| Onde | Mudança |
|---|---|
| `backend/src/modules/areas/areaPastagemService.js` · `mapGeography/pontoReferenciaService.js` · `mapGeography/linhaGeograficaService.js` · `setores/setorService.js` | `criar` passa por `criarComIdDoAparelho`: repetir devolve o mesmo registro, outra conta dá 409, criado e excluído dá 409 |
| Rotas (`areaPastagemRoutes.js`, `mapGeographyRoutes.js`, `setorRoutes.js`) | O POST aceita `id` (UUID) |
| `src/apis/areas/areaPastagemNativePort.js` · `src/apis/mapaGeografia/mapaGeografiaNativePort.js` · `src/apis/setores/setorNativePort.js` | `idDoAparelho: true`, e a criação manda o id |

## Verificação

- `backend/tests/idDoAparelhoCadastrosD355.test.mjs`:
  - IA-01: a mesma criação repetida devolve o mesmo registro, com uma linha só, para os quatro cadastros;
  - IA-02: o mesmo id em outra conta dá 409;
  - IA-03: criado e excluído não é recriado;
  - IA-04: sem id, funciona como antes.
  - IA-01 a IA-03 falham no servidor antigo.
- `tests/smoke/idDoAparelhoCadastrosD355.test.js`, IC-01 e IC-02: as portas pedem e mandam o id.
- Os testes do servidor de área, cultura, ocupação, mapa, setor, versão e mudanças passam.
- `tests/smoke/depositoTransferenciaOffline.test.js` ET-09: falhava de vez em quando, em 1 de 5 rodadas aqui e também no GitHub. O teste se isolava pela pessoa (`usr_et09`) dentro da mesma conta dos testes anteriores (`cli_1`). Desde a D-PROD-350, o dono da fila é a conta, e ele às vezes via o que sobrou deles. Agora usa uma conta própria, como o ET-05 a ET-08, e passou em 8 de 8 rodadas. O que o teste confere não mudou.
- `test:smoke`: 4741 de 4741.
- Os gates passam.

## O que ficou para depois

- Os outros cadastros que ainda não usam o id do aparelho (local de estoque, lote de suplementação, movimentação do mapa e alguns de escritório). São criados quase sempre com internet.
