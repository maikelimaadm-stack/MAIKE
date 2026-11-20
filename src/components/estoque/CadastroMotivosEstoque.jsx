import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AvisoGestao, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";

/**
 * Cadastro de motivos do Estoque (entrada, D-PROD-259; saída, D-PROD-264), DENTRO da janela "Novo movimento" (sem
 * popup sobre popup): lista, incluir, renomear e ativar/desativar. Um motivo `padrao` (o "Saldo de implantação" da
 * entrada) é fixo: não se renomeia nem se desativa. Os motivos de saída não têm fixo.
 * @param {{
 *   titulo: string,
 *   explicacao: string,
 *   chave: readonly unknown[],
 *   listar: () => Promise<any[]>,
 *   criar: (nome: string) => Promise<any>,
 *   editar: (id: string, dados: { nome?: string, ativo?: boolean }) => Promise<any>,
 *   mensagemErro: (erro: unknown, padrao: string) => string,
 *   rotuloVoltar: string,
 *   testId: string,
 *   onVoltar: () => void,
 * }} props
 */
export default function CadastroMotivosEstoque({ titulo, explicacao, chave, listar, criar, editar, mensagemErro, rotuloVoltar, testId, onVoltar }) {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: [...chave], queryFn: () => listar(), staleTime: 30 * 1000 });
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState(/** @type {{ id: string, nome: string } | null} */ (null));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(/** @type {string|null} */ (null));

  /** @param {() => Promise<any>} acao */
  const executar = async (acao) => {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      await queryClient.invalidateQueries({ queryKey: [...chave] });
    } catch (falha) {
      setErro(mensagemErro(falha, "Não foi possível salvar o motivo."));
    } finally {
      setOcupado(false);
    }
  };

  const motivos = consulta.data ?? [];
  return (
    <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2" data-testid={testId}>
      <SecaoForm titulo={titulo} />
      <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">{explicacao}</p>
      <ul className="col-span-12 divide-y divide-[var(--mg-border,#e2e8f0)]" data-testid={`${testId}-lista`}>
        {motivos.map((/** @type {any} */ m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[13px]" data-testid={`motivo-${m.id}`}>
            {editando?.id === m.id ? (
              <>
                <input
                  value={editando.nome}
                  onChange={(ev) => setEditando({ id: m.id, nome: ev.target.value })}
                  maxLength={80}
                  className="mg-input min-w-0 flex-1 normal-case"
                  aria-label="Novo nome do motivo"
                  data-testid="motivo-editar-nome"
                />
                <button type="button" className="tb-btn tb-btn-green" disabled={ocupado} onClick={() => executar(async () => { await editar(m.id, { nome: editando.nome }); setEditando(null); })} data-testid="motivo-salvar-nome">
                  Salvar
                </button>
                <button type="button" className="tb-btn" disabled={ocupado} onClick={() => setEditando(null)}>Cancelar</button>
              </>
            ) : (
              <>
                <span className={`min-w-0 flex-1 ${m.ativo ? "" : "line-through opacity-60"}`}>{m.nome}</span>
                {m.padrao ? <span className="text-[11px] text-[var(--mg-text-2,#475569)]">padrão</span> : null}
                {!m.padrao ? (
                  <>
                    <button type="button" className="tb-btn" disabled={ocupado} onClick={() => setEditando({ id: m.id, nome: m.nome })} data-testid={`motivo-${m.id}-renomear`}>Renomear</button>
                    <button type="button" className="tb-btn" disabled={ocupado} onClick={() => executar(() => editar(m.id, { ativo: !m.ativo }))} data-testid={`motivo-${m.id}-ativo`}>
                      {m.ativo ? "Desativar" : "Reativar"}
                    </button>
                  </>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      <CampoTexto label="Novo motivo" value={novo} onChange={setNovo} maxLength={80} span={9} keepCase />
      <div className="col-span-12 flex items-end md:col-span-3">
        <button
          type="button"
          className="tb-btn tb-btn-green w-full"
          disabled={ocupado || [...novo.trim()].length < 2}
          onClick={() => executar(async () => { await criar(novo.trim()); setNovo(""); })}
          data-testid="motivo-incluir"
        >
          <Plus size={14} aria-hidden /> Incluir
        </button>
      </div>
      {erro ? (
        <div className="col-span-12" role="alert" data-testid="motivos-erro">
          <AvisoGestao>{erro}</AvisoGestao>
        </div>
      ) : null}
      <div className="col-span-12">
        <button type="button" className="tb-btn" onClick={onVoltar} data-testid="motivos-voltar">{rotuloVoltar}</button>
      </div>
    </div>
  );
}
