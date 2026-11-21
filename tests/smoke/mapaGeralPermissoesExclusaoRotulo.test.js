/**
 * Permissão do mapa que libera desfazer lançamento de cocho e transferência de depósito (D-PROD-268): o texto que a
 * pessoa vê é de EXCLUSÃO (pedido do proprietário: "não tenho cancelamentos, tenho exclusão"). A chave gravada
 * continua `cancelar_lancamentos_estoque` (nada muda no servidor nem nas permissões já salvas).
 */
import { describe, it, expect } from "vitest";
import {
  CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE,
  MAPA_GERAL_ACOES_GRAVADORAS,
  MAPA_GERAL_PERMISSION_GROUPS,
  podeCancelarLancamentosEstoque,
} from "@/lib/mapaGeralPermissions";

const itens = MAPA_GERAL_PERMISSION_GROUPS.flatMap((g) => g.items);

describe("Permissão do mapa — rótulo de exclusão (cocho e depósito)", () => {
  it("o rótulo diz Excluir; a chave continua cancelar_lancamentos_estoque", () => {
    const item = itens.find((i) => i.key === "cancelar_lancamentos_estoque");
    expect(item).toBeTruthy();
    expect(item?.label).toBe("Excluir lançamento de cocho e transferência de depósito");
    expect(item?.label).not.toMatch(/cancel|estorn/i);
    expect(CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE).toBe("cancelar_lancamentos_estoque");
    expect(MAPA_GERAL_ACOES_GRAVADORAS).toContain("cancelar_lancamentos_estoque");
  });

  it("a regra de quem vê não mudou (admin real ou is_admin liberam; sem permissão, não)", () => {
    expect(podeCancelarLancamentosEstoque({ administrador_fazenda: true }, null)).toBe(true);
    expect(podeCancelarLancamentosEstoque({ administrador_fazenda: false }, { is_admin: true })).toBe(true);
    expect(podeCancelarLancamentosEstoque({ administrador_fazenda: false }, null)).toBe(false);
  });
});
