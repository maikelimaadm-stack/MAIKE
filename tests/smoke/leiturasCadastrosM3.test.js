/**
 * D-PROD-137 (frente M3) — consumidores do contrato novo das leituras.
 *
 *  GET-05  o formulário de tarefa lista quem o SERVIDOR diz ser responsável
 *          (`responsavel_elegivel`); com a concessão is_admin antes só listava
 *          a si mesmo (a matriz dos colegas não vem).
 *  EMP-01  exclusão de empresa recusada (409 EMPRESA_COM_VINCULOS) tem
 *          mensagem própria, com a contagem dos vínculos.
 */
import { describe, it, expect } from "vitest";

import { ordenarResponsaveisTarefa } from "@/components/mapa/FormularioTarefaMapa";
import { comoUsuarioLegado } from "@/apis/usuarios/usuarioNativePort.js";
import { descreverVinculosEmpresa } from "@/services/empresaService";
import { ApiError, API_ERROR_CODES, getApiErrorMessage } from "@/apis/_core/ApiError";

describe("GET-05 — responsáveis da tarefa vêm do servidor", () => {
  it("comoUsuarioLegado preserva responsavel_elegivel (booleano) e não inventa quando ausente", () => {
    expect(comoUsuarioLegado({ id: "1", login: "a", nome: "A", ativo: true, responsavel_elegivel: true }).responsavel_elegivel).toBe(true);
    expect(comoUsuarioLegado({ id: "2", login: "b", nome: "B", ativo: true, responsavel_elegivel: false }).responsavel_elegivel).toBe(false);
    expect("responsavel_elegivel" in comoUsuarioLegado({ id: "3", login: "c", nome: "C" })).toBe(false);
  });

  it("concessão is_admin: colega B (is_admin) e o admin real SEM linha aparecem; quem só vê o mapa não", () => {
    const usuarios = [
      { id: "a", email: "a", nome: "Gerente A", responsavel_elegivel: true },
      { id: "b", email: "b", nome: "Gerente B", responsavel_elegivel: true },
      { id: "adm", email: "dono", nome: "Dono", responsavel_elegivel: true },
      { id: "op", email: "peao", nome: "Peão", responsavel_elegivel: false },
    ];
    // O que is_admin recebe de /permissoes: a própria linha inteira e, das outras, só o nome.
    const permissoes = [
      { id: "pa", user_email: "a", user_nome: "Gerente A", is_admin: true, modulos_permitidos: [], permissoes_telas: [] },
      { id: "pb", user_email: "b", user_nome: "Gerente B" },
      { id: "pop", user_email: "peao", user_nome: "Peão" },
    ];
    expect(ordenarResponsaveisTarefa(usuarios, permissoes).map((u) => u.id)).toEqual(["adm", "a", "b"]);
  });

  it("sem o campo (só a própria conta), segue a regra local da própria linha", () => {
    const usuarios = [{ id: "a", email: "a", nome: "A" }];
    const linha = { user_email: "a", modulos_permitidos: ["gestao-tarefas"], permissoes_telas: [{ tela_id: "gt-lancamentos", visualizar: true }] };
    expect(ordenarResponsaveisTarefa(usuarios, [linha]).map((u) => u.id)).toEqual(["a"]);
    expect(ordenarResponsaveisTarefa(usuarios, [{ user_email: "a", modulos_permitidos: ["mapa"] }])).toEqual([]);
  });
});

describe("EMP-01 — empresa com vínculos não é excluída e a tela diz por quê", () => {
  it("o código atravessa com mensagem própria e a contagem vira frase", () => {
    const erro = new ApiError(API_ERROR_CODES.EMPRESA_COM_VINCULOS, {
      details: { vinculos: [{ entidade: "Setor", total: 2 }, { entidade: "Lote", total: 1 }, { entidade: "PesoRebanho", total: 3 }] },
    });
    expect(getApiErrorMessage(erro)).toMatch(/registros vinculados/);
    expect(descreverVinculosEmpresa(erro)).toBe("Não é possível excluir a empresa: ela tem registros vinculados — setores (2), lotes (1), outros registros (3). Nada foi apagado.");
    expect(descreverVinculosEmpresa(new ApiError(API_ERROR_CODES.EMPRESA_NOT_FOUND))).toBeNull();
  });
});
