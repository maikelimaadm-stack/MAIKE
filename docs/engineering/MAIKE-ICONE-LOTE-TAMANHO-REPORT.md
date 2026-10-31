# MAIKE — ícone do lote no mapa: tamanho e quantidade (D-PROD-89)

**Pedido:** ícone do lote um pouco menor; número de cabeças um pouco menor e
um pouco mais acima.

| Item | Antes | Depois |
|---|---|---|
| Ícone do lote (`baseSize`) | 50 px | 44 px |
| Raio do círculo | 22 | 19 |
| Deslocamento do marcador | [0, −30] | [0, −26] |
| Fonte base da quantidade | 11 px | 10 px |
| Posição da quantidade | 72% da altura | 66% |
| Selo do identificador | +20 / −25 px | +18 / −22 px |

A faixa de largura do número (22 px) foi mantida: cabe no ícone de 44 px, e
números longos continuam encolhendo para não passar da figura (mínimo 5 px).

**Testes:**
- `contagemLote` 4/4;
- `maplibreAreasUnificacao` 31/31, `menuNavFreeze` 11/11, `maplibreEditorParidadeVisual` 18/18;
- `npm run verify:all` antes do push.

**Fora do escopo:** ícones de ponto e de bebedouro (40 px), sem mudança.
