# P4.4-Marcas — Native Persistence (piloto de cadastros)

**Missão:** migrar `Marca` da Base44 para o backend nativo.  
**Decisão:** D-PROD-43  
**Branch:** `cursor/p4-marcas-native-516d`

---

## 1. Entregue

| Verificação | Estado |
|---|---|
| Model Prisma `Marca` tenant-scoped + migration | ✅ |
| Rotas autenticadas `/marcas` (CRUD) | ✅ |
| Numeração `EntidadeCodigoSequencia` (sem MAX+1 no cliente) | ✅ |
| Frontend `marcasApi` → `marcaNativePort` | ✅ |
| `marcasProvider` removido do `base44Provider` | ✅ |
| `vercel.json` rewrite `/marcas` | ✅ |
| `gate:marca-native` + testes backend | ✅ |

---

## 2. Follow-up (fora deste PR)

| Cadastro | Estado |
|---|---|
| **Produtos** | Base44 — depende de marca nativa para próxima fatia |
| **UnidadeMedida** | Base44 |
| **Empresa** | Base44 |
| **Categorias / Lotes / Bebedouros** | Base44 |
| **Cliente (tenant UI)** | Não existe — só bootstrap |

Ordem sugerida após merge: **UnidadeMedida** ou **Produtos** (maior acoplamento com Marcas).

---

## 3. Arquivos principais

- `backend/prisma/migrations/20261027140000_p4_marcas_native/`
- `backend/src/modules/marcas/*`
- `src/apis/marcas/marcaNativePort.js`
- `scripts/gates/gate-marca-native.mjs`
- `backend/tests/marcaNativo.test.mjs`

---

## 4. Produção

Aplicar migrations (`npm run deploy:migrate` / Supabase) antes do deploy do
monólito Vercel. Sem migration, `/marcas` retorna erro de banco.
