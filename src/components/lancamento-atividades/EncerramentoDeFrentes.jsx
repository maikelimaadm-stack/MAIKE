import React from "react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { AvisoGestao, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { formatarHorimetro } from "@/lib/aberturaServicoRegras";
import { tituloDaFrente } from "@/components/lancamento-atividades/AtividadeComFrentes";

/**
 * D-PROD-348 — os painéis de encerramento do Diário das atividades, no próprio passo (como o painel "Em breve"):
 *  - `PainelEncerrarFrente`: o serviço de UMA frente (passo `iniciado`), com o horímetro final;
 *  - `PainelEncerrarAtividade`: a atividade (passo `atividade`), com o horímetro final de cada frente ABERTA, ou só a
 *    confirmação quando não há frente aberta.
 * Só apresentação: o estado, a validação e o envio ficam no `DiarioDasAtividades`.
 */

/**
 * O painel "Encerrar serviço" da frente tocada: o resumo (máquina + implemento) e o "Horímetro final" (obrigatório, a dica
 * traz o inicial). @param {{ abertura: any, horimetroFinal: string, erro?: string, readOnly: boolean, onChange: (valor: string) => void }} props
 */
export function PainelEncerrarFrente({ abertura, horimetroFinal, erro = undefined, readOnly, onChange }) {
  return (
    <section className="b1-aberto-painel" aria-label="Encerrar serviço" data-testid="servico-encerrar-painel">
      <strong className="b1-aberto-painel__titulo">Encerrar serviço</strong>
      <p className="b1-aberto-breve">{tituloDaFrente(abertura)}</p>
      <div className="grid grid-cols-12 gap-3 b1-form-embutido" data-densidade={DENSIDADE_BASE1}>
        <CampoTexto
          label="Horímetro final"
          required
          value={horimetroFinal}
          onChange={onChange}
          error={erro}
          span={12}
          inputMode="decimal"
          keepCase
          readOnly={readOnly}
          dica={`Horímetro inicial ${formatarHorimetro(abertura?.horimetro) || "—"}`}
          testId="encerrar-horimetro"
        />
      </div>
    </section>
  );
}

/**
 * O painel "Encerrar atividade": enquanto as frentes são lidas, "Carregando…"; se a leitura falhou, o aviso e "Tentar de novo"
 * (sem horímetro, sem confirmação). Lidas: com frentes abertas, o "Horímetro final" de cada uma (obrigatório, com a dica do
 * inicial); sem nenhuma, só a pergunta de confirmação.
 * @param {{ nome: string, abertas: Array<{ chave: string, abertura: any }>, lendo?: boolean, erroLeitura?: boolean, onTentarLeitura?: () => void, valores: Record<string, string>, erros: Record<string, string>, readOnly: boolean, onChange: (chave: string, valor: string) => void }} props
 */
export function PainelEncerrarAtividade({ nome, abertas, lendo = false, erroLeitura = false, onTentarLeitura = undefined, valores, erros, readOnly, onChange }) {
  if (lendo) {
    return (
      <section className="b1-aberto-painel" aria-label="Encerrar atividade" data-testid="atividade-encerrar-painel">
        <strong className="b1-aberto-painel__titulo">Encerrar atividade</strong>
        <p role="status" className="b1-aberto-breve" data-testid="atividade-encerrar-lendo">
          Carregando as máquinas desta atividade…
        </p>
      </section>
    );
  }
  if (erroLeitura) {
    return (
      <section className="b1-aberto-painel" aria-label="Encerrar atividade" data-testid="atividade-encerrar-painel">
        <strong className="b1-aberto-painel__titulo">Encerrar atividade</strong>
        <AvisoGestao testId="atividade-encerrar-erro-leitura">Não foi possível ler as máquinas desta atividade. Tente de novo antes de encerrar.</AvisoGestao>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onTentarLeitura} disabled={readOnly} data-testid="atividade-encerrar-tentar">
          Tentar de novo
        </button>
      </section>
    );
  }
  return (
    <section className="b1-aberto-painel" aria-label="Encerrar atividade" data-testid="atividade-encerrar-painel">
      <strong className="b1-aberto-painel__titulo">Encerrar atividade</strong>
      {abertas.length === 0 ? (
        <p className="b1-aberto-breve">{`Encerrar a atividade ${nome} neste pasto?`}</p>
      ) : (
        <>
          <p className="b1-aberto-breve">Informe o horímetro final de cada máquina em campo. As que estão abertas são encerradas junto com a atividade.</p>
          <div className="grid grid-cols-12 gap-3 b1-form-embutido" data-densidade={DENSIDADE_BASE1}>
            {abertas.map((f) => (
              <CampoTexto
                key={f.chave}
                label={`Horímetro final · ${tituloDaFrente(f.abertura)}`}
                required
                value={valores[f.chave] ?? ""}
                onChange={(v) => onChange(f.chave, v)}
                error={erros[f.chave]}
                span={12}
                inputMode="decimal"
                keepCase
                readOnly={readOnly}
                dica={`Horímetro inicial ${formatarHorimetro(f.abertura?.horimetro) || "—"}`}
                testId={`atividade-encerrar-horimetro-${encodeURIComponent(f.chave)}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
