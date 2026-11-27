import React from "react";
import { ChevronRight, Plus, Tractor } from "lucide-react";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { formatarHorimetro, horasDaFrenteNoDia, resumoDasFrentes, textoDasHorasHoje, textoDasMaquinasEmCampo } from "@/lib/aberturaServicoRegras";
import { STATUS_AREA } from "@/lib/atividadeAreasRegras";
import { iconeDoTipoAtividade } from "@/lib/iconesTipoAtividade";

/**
 * D-PROD-348 — o JSX do passo `atividade` do Diário das atividades (a atividade inteira, uma por área e tipo) e dos seus
 * cartões: a linha da atividade no passo `escolher`, o cartão de cada FRENTE (máquina + implemento) e o cabeçalho.
 * Só apresentação: o estado, as leituras e os envios ficam no `DiarioDasAtividades`.
 */

/** "26/11" a partir do dia ISO (AAAA-MM-DD); sem dia, "". @param {unknown} iso */
export const diaCurto = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? "")) ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");

/** "26/11/2026" a partir do dia ISO (AAAA-MM-DD); sem dia, "". @param {unknown} iso */
const diaComAno = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? "")) ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : "");

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "nov/26" a partir do dia ISO (AAAA-MM-DD), em pt-BR minúsculo; sem dia válido, "". @param {unknown} iso */
export const mesCurto = (iso) => {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso ?? ""));
  const mes = m ? Number(m[2]) : 0;
  return mes >= 1 && mes <= 12 ? `${MESES_CURTOS[mes - 1]}/${String(m?.[1]).slice(2)}` : "";
};

/** O título de uma frente: a máquina, com " + " e o implemento quando há um. @param {any} abertura */
export const tituloDaFrente = (abertura) => {
  const bem = abertura?.bemNome || "Máquina";
  return abertura?.implementoNome ? `${bem} + ${abertura.implementoNome}` : bem;
};

/**
 * Um cartão de FRENTE (máquina + implemento) da atividade. Aberta é tocável (abre o serviço dela); encerrada não (cartão
 * desabilitado, sem seta, com o horímetro final no lugar de "Hoje").
 * D-PROD-348 (item 1): o "Hoje" é as horas trabalhadas no dia (`horasHoje`, de `horasDaFrenteNoDia`); sem elas, "Nada hoje".
 * @param {{ id: string, frente: { chave: string, abertura: any, encerrada: boolean, horimetroFinal: string }, horasHoje: string | null, ocupado: boolean, onAbrir: (chave: string) => void }} props
 */
export function CartaoDaFrente({ id, frente, horasHoje, ocupado, onAbrir }) {
  const { abertura, chave, encerrada, horimetroFinal } = frente;
  const titulo = abertura.bemNome || "Máquina";
  return (
    <li>
      <button type="button" className="frente-card" disabled={encerrada || ocupado} onClick={() => onAbrir(chave)} data-testid={`frente-${id}-${encodeURIComponent(chave)}`}>
        <span className="frente-card__ic" aria-hidden>
          <Tractor size={18} strokeWidth={1.75} />
        </span>
        <span className="frente-card__corpo">
          <span className="frente-card__l1">
            <strong>{titulo}</strong>
            <span className={encerrada ? "b1-aberto-chip b1-aberto-chip--neutro" : "b1-aberto-chip"}>{encerrada ? "● Encerrado" : "● Aberto"}</span>
          </span>
          <span className="frente-card__grid">
            <span>
              <i>Implemento</i>
              {abertura.implementoNome || "—"}
            </span>
            <span>
              <i>Operador</i>
              {abertura.responsavelNome || "—"}
            </span>
            <span>
              <i>Horímetro inicial</i>
              {formatarHorimetro(abertura.horimetro) || "—"}
            </span>
            {encerrada ? (
              <span>
                <i>Horímetro final</i>
                {formatarHorimetro(horimetroFinal) || "—"}
              </span>
            ) : (
              <span data-testid="frente-hoje">
                <i>Hoje</i>
                {textoDasHorasHoje(horasHoje)}
              </span>
            )}
          </span>
        </span>
        {encerrada ? null : <ChevronRight className="seta" size={18} aria-hidden />}
      </button>
    </li>
  );
}

/**
 * A linha de uma atividade aberta no passo `escolher` ("Em andamento neste pasto"): um cartão por ATIVIDADE. A linha traz as
 * máquinas em campo (quando as frentes já foram lidas; `frentes` nulo = lendo) e o início. Toque → o passo `atividade`.
 * @param {{ atividade: any, frentes: any[] | null, ocupado: boolean, onTocar: (atividade: any) => void }} props
 */
export function CartaoDaAtividade({ atividade, frentes, ocupado, onTocar }) {
  const id = String(atividade.atividade_id);
  // D-PROD-348: o título é o TIPO da atividade e o mês de início ("Gradeação · nov/26"); sem tipo, o nome dela como antes.
  const tipo = atividade.tipo_atividade_nome;
  const nome = tipo ? [tipo, mesCurto(atividade.data_inicio)].filter(Boolean).join(" · ") : atividade.nome || "Atividade";
  const Icone = iconeDoTipoAtividade({ nome_tipo: atividade.tipo_atividade_nome ?? atividade.nome });
  const maquinas = frentes ? textoDasMaquinasEmCampo(resumoDasFrentes(frentes).abertas) : "";
  const inicio = diaCurto(atividade.data_inicio);
  const sub = [maquinas, inicio ? `Início ${inicio}` : ""].filter(Boolean).join(" · ");
  const rotulo = atividade.area_status === STATUS_AREA.PLANEJADA ? "Aberta" : "Em andamento";
  return (
    <div role="listitem">
      <button type="button" className="b1-aberto-opcao" onClick={() => onTocar(atividade)} disabled={ocupado} data-testid={`diario-atividade-aberta-${id}`}>
        <span className="b1-aberto-opcao__icone" aria-hidden>
          <Icone size={18} strokeWidth={1.75} />
        </span>
        <span className="b1-aberto-opcao__texto">
          <strong className="b1-aberto-opcao__titulo">{nome}</strong>
          {sub ? <span className="b1-aberto-opcao__sub">{sub}</span> : null}
        </span>
        <span className="b1-aberto-chip" data-testid={`diario-atividade-aberta-etiqueta-${id}`}>
          {rotulo}
        </span>
        <ChevronRight className="b1-aberto-opcao__seta" size={18} aria-hidden />
      </button>
    </div>
  );
}

/**
 * O passo `atividade` (tela b): o cabeçalho verde (nome do tipo, Pasto, Início e Máquinas), o título "Máquinas nesta
 * atividade" com um cartão por frente e "Adicionar máquina". Sem frente, o aviso. `painel` (o encerramento da atividade)
 * entra no lugar da lista quando a pessoa está encerrando. Lendo, erro e aviso vêm das props.
 * @param {{
 *   atividade: any, nome: string, pasto: string, frentes: any[], apontamentos: any[], lendo: boolean, erro: boolean,
 *   hoje: string, ocupado: boolean, painel?: import('react').ReactNode,
 *   onAbrirFrente: (chave: string) => void, onAdicionar: () => void,
 * }} props
 */
export default function AtividadeComFrentes({ atividade, nome, pasto, frentes, apontamentos, lendo, erro, hoje, ocupado, painel = null, onAbrirFrente, onAdicionar }) {
  const id = String(atividade?.id ?? "");
  const maquinas = lendo || erro ? "—" : textoDasMaquinasEmCampo(resumoDasFrentes(frentes).abertas);
  const inicio = diaComAno(atividade?.data_inicio);
  return (
    <div className="b1-realizacao__passo" data-testid="atividade-passo">
      <section className="b1-ativ-topo" aria-label="Atividade aberta" data-testid="atividade-topo">
        <div className="b1-ativ-topo__l1">
          <strong>{nome}</strong>
          <span className="b1-aberto-chip">● Aberto</span>
        </div>
        <div className="b1-ativ-meta">
          <div>
            <i>Pasto</i>
            {pasto || "—"}
          </div>
          <div>
            <i>Início</i>
            {inicio || "—"}
          </div>
          <div>
            <i>Máquinas</i>
            {maquinas}
          </div>
        </div>
      </section>
      {painel ?? (
        <>
          {erro ? (
            <AvisoGestao testId="atividade-erro-leitura">Não foi possível ler as máquinas desta atividade.</AvisoGestao>
          ) : lendo ? (
            <p role="status" className="b1-realizacao__ajuda" data-testid="atividade-carregando">
              Carregando…
            </p>
          ) : frentes.length === 0 ? (
            <p className="b1-realizacao__ajuda" data-testid="atividade-sem-maquina">
              Esta atividade não tem máquina em campo.
            </p>
          ) : (
            <>
              <h3 className="b1-aberto-secao frente-grupo">Máquinas nesta atividade</h3>
              <ul className="frente-lista" aria-label="Máquinas em campo">
                {frentes.map((f) => (
                  <CartaoDaFrente
                    key={f.chave}
                    id={id}
                    frente={f}
                    horasHoje={horasDaFrenteNoDia(apontamentos, f.chave, hoje, f.abertura.horimetro)}
                    ocupado={ocupado}
                    onAbrir={onAbrirFrente}
                  />
                ))}
              </ul>
            </>
          )}
          <button type="button" className="frente-add" onClick={onAdicionar} disabled={ocupado} data-testid="atividade-adicionar-maquina">
            <span className="frente-add__ic" aria-hidden>
              <Plus size={14} strokeWidth={2} />
            </span>
            Adicionar máquina
          </button>
        </>
      )}
    </div>
  );
}
