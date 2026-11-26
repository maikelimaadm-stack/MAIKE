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

  it("nova/editar tarefa, detalhes, evento, histórico e a lista de tarefas abrem no diálogo padrão", () => {
    // D-PROD-325: o formulário entra NO LUGAR da lista, na mesma janela do mapa (sem um segundo diálogo por cima).
    const painel = ler("src/components/mapa/TarefasMapaPanel.jsx");
    expect(painel).not.toMatch(/<LancLoteDialogo/);
    expect(painel).toMatch(/if \(showForm\) \{\s*return \(\s*<FormularioTarefaMapa/);
    const det = ler("src/components/mapa/DetalhesTarefaMapa.jsx");
    for (const t of ["Editar tarefa", "Histórico da tarefa", "Registrar evento"]) {
      expect(det, t).toMatch(new RegExp(`<LancLoteDialogo[^>]*titulo="${t}"`));
    }
    expect(det).not.toMatch(/Mesmo padrão da tela de lançamentos/);
    const mapa = ler("src/pages/MapaGeral.jsx");
    // D-PROD-321: a lista de tarefas abre como os detalhes do lote (largo, só leitura, popup a partir do tablet).
    // D-PROD-325: lista, detalhes e formulário numa janela só (largo, só leitura fora do formulário, popup a partir
    // do tablet); não há mais um diálogo "Detalhes da tarefa" separado.
    expect(mapa).toMatch(/<LancLoteDialogo open=\{showTarefas \|\| showDetalhesTarefa\}(?:(?!<\/?LancLoteDialogo)[\s\S])*?'Detalhes da tarefa' : 'Tarefas'(?:(?!<\/?LancLoteDialogo)[\s\S])*?largo somenteLeitura=\{!\(formularioTarefa && telaTarefa === 'lista'\)\} popupDesde="tablet"/);
    expect(mapa).not.toMatch(/<LancLoteDialogo open=\{showDetalhesTarefa\}/);
  });

  it("evento: o tipo escolhido é sempre um dos permitidos (não grava 'Em Andamento' numa tarefa já iniciada)", () => {
    const det = ler("src/components/mapa/DetalhesTarefaMapa.jsx");
    expect(det).toMatch(/const tipoEventoValido = opcoesEvento\.some\(\(o\) => o\.value === eventoTipo\) \? eventoTipo : opcoesEvento\[0\]\?\.value/);
    expect(det).toMatch(/valor=\{tipoEventoValido\}/);
  });
});
