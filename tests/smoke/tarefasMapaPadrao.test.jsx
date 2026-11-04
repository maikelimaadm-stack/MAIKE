// @vitest-environment jsdom
/**
 * D-PROD-118 — tarefas do Mapa Geral no padrão dos lançamentos: abertura
 * padrão (LancLoteDialogo), um cabeçalho só, listas do cadastro (B1Select) e
 * o tipo do evento sempre entre os permitidos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p) => readFileSync(p, "utf8");

describe("Tarefas do Mapa no padrão (D-PROD-118)", () => {
  it("formulário da tarefa: sem cartão com cabeçalho próprio, listas do cadastro e ação no ✓ do cabeçalho", () => {
    const f = ler("src/components/mapa/FormularioTarefaMapa.jsx");
    expect(f).not.toMatch(/<CardHeader|<CardTitle|Lançar Nova Tarefa/);
    expect(f).not.toMatch(/@\/components\/ui\/select/);
    expect(f).toMatch(/<B1Select\b/);
    expect(f).toMatch(/<LancLoteRodape\b/);
    expect(f).not.toMatch(/__sem_setor__/);
  });

  it("nova/editar tarefa, detalhes, evento, histórico e Gestão de Tarefas abrem no diálogo padrão", () => {
    expect(ler("src/components/mapa/TarefasMapaPanel.jsx")).toMatch(/<LancLoteDialogo[\s\S]*?titulo=\{editingTarefa \? 'Editar tarefa' : 'Nova tarefa'\}/);
    const det = ler("src/components/mapa/DetalhesTarefaMapa.jsx");
    for (const t of ["Editar tarefa", "Histórico da tarefa", "Registrar evento"]) {
      expect(det, t).toMatch(new RegExp(`<LancLoteDialogo[^>]*titulo="${t}"`));
    }
    expect(det).not.toMatch(/Mesmo padrão da tela de lançamentos/);
    const mapa = ler("src/pages/MapaGeral.jsx");
    expect(mapa).toMatch(/<LancLoteDialogo(?:(?!<\/?LancLoteDialogo)[\s\S])*?titulo="Gestão de Tarefas"(?:(?!<\/?LancLoteDialogo)[\s\S])*?amplo somenteLeitura/);
    expect(mapa).toMatch(/<LancLoteDialogo(?:(?!<\/?LancLoteDialogo)[\s\S])*?titulo="Detalhes da tarefa"(?:(?!<\/?LancLoteDialogo)[\s\S])*?somenteLeitura/);
    expect(ler("src/components/tarefas/TarefaDetalhesDialog.jsx")).toMatch(/<LancLoteDialogo[^>]*somenteLeitura/);
  });

  it("evento: o tipo escolhido é sempre um dos permitidos (não grava 'Em Andamento' numa tarefa já iniciada)", () => {
    const det = ler("src/components/mapa/DetalhesTarefaMapa.jsx");
    expect(det).toMatch(/const tipoEventoValido = opcoesEvento\.some\(\(o\) => o\.value === eventoTipo\) \? eventoTipo : opcoesEvento\[0\]\?\.value/);
    expect(det).toMatch(/valor=\{tipoEventoValido\}/);
  });
});
