import React, { useState } from 'react';
import { CloudUpload, AlertTriangle, Clock, Hourglass, Loader2, ChevronDown, ChevronUp, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFilaDeEnvio } from '@/hooks/useFilaDeEnvio';
import { enviarAgora, tentarEnviarDeNovo, descartarRegistroNaoEnviado, dependentesDoRegistro } from '@/services/sincronizacaoService';
import { confirmar } from '@/lib/maikeConfirmar';
import { notifyError } from '@/lib/maikeNotify';

const quando = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime()) || d.getTime() === 0) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** O que a pessoa lê na situação de cada item. */
const SITUACAO = {
  aguardando: 'Aguardando envio',
  confirmando: 'Enviado — esperando a confirmação do sistema',
  esperando: 'Esperando outro registro subir antes',
  atencao: 'Precisa de atenção',
};

const ICONE = { aguardando: Clock, confirmando: Loader2, esperando: Hourglass, atencao: AlertTriangle };

/** Botão de ação do item: pequeno, para os três caberem numa linha no celular. */
const ACAO = 'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50';

/**
 * D-PROD-295 / D-PROD-328 — "Envio": a FILA ÚNICA do que foi feito sem internet e ainda não chegou ao sistema,
 * dentro da janela "Sincronização" (D-PROD-301). Tudo entra aqui — cochos e depósitos, cadastros, tarefas e fotos —
 * e cada item mostra o que é, quando foi feito e a situação, com três ações:
 *  - "Ver detalhes": o que aconteceu (tentativas, última tentativa, motivo) e o conteúdo do registro;
 *  - "Tentar de novo": envia já (e tira a recusa, se houver);
 *  - "Excluir": a pessoa decide que ele não vai ao sistema (pede confirmação, com o aviso do que acontece).
 * Nada fica preso sem saída.
 */
export default function FilaDeEnvio() {
  const fila = useFilaDeEnvio();
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(/** @type {string|null} */ (null));

  if (fila.aguardando === 0 && fila.atencao === 0) {
    return <p className="text-sm text-slate-500">Tudo enviado: nenhum registro esperando.</p>;
  }

  const executar = async (acao) => {
    setOcupado(true);
    try {
      await acao();
    } finally {
      setOcupado(false);
      fila.recarregar();
    }
  };

  const excluir = async (item) => {
    // D-PROD-311: só o último da sequência sai — com um registro posterior que depende deste,
    // a pessoa exclui primeiro o mais recente.
    const dependentes = await dependentesDoRegistro(item.id);
    if (dependentes.length) {
      notifyError('Exclua primeiro o mais recente', `Este registro tem outro depois dele que depende dele. Exclua antes: ${dependentes.map((d) => d.rotulo).join('; ')}.`);
      return;
    }
    const ok = await confirmar({
      titulo: 'Excluir este registro?',
      descricao: `"${item.rotulo}" não vai chegar ao sistema.${item.avisoAoExcluir ? ` ${item.avisoAoExcluir}` : ''} Isso não pode ser desfeito.`,
      textoConfirmar: 'Excluir',
      perigo: true,
    });
    if (ok) await executar(() => descartarRegistroNaoEnviado(item.id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">
          {fila.aguardando > 0 && <>{fila.aguardando} aguardando envio</>}
          {fila.aguardando > 0 && fila.atencao > 0 && ' · '}
          {fila.atencao > 0 && <span className="text-amber-700">{fila.atencao} precisa(m) de atenção</span>}
        </p>
        <Button type="button" size="sm" variant="outline" disabled={ocupado || fila.enviando} onClick={() => executar(enviarAgora)}>
          <CloudUpload className="mr-1 h-4 w-4" aria-hidden="true" />
          {fila.enviando ? 'Enviando…' : 'Enviar agora'}
        </Button>
      </div>

      {fila.itens.length > 0 && (
        <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto" aria-label="Fila de envio">
          {fila.itens.map((item) => {
            const Icone = ICONE[item.estado] ?? Clock;
            const atencao = item.estado === 'atencao';
            const mostrando = aberto === item.id;
            return (
              <li key={item.id} data-mk-fila-item={item.origem} className={`rounded-md border px-2.5 py-2 text-sm ${atencao ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <div className="flex items-start gap-1.5">
                  <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${atencao ? 'text-amber-600' : 'text-slate-400'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">{item.rotulo}</p>
                    <p className="text-xs text-slate-500">Feito em {quando(item.criado_em)} · {SITUACAO[item.estado] ?? item.estado}</p>
                    {item.motivo && <p className={`mt-0.5 text-xs ${atencao ? 'text-amber-800' : 'text-slate-600'}`}>{item.motivo}</p>}
                  </div>
                </div>

                {mostrando && (
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded bg-white/70 px-2 py-1.5 text-xs" aria-label={`Detalhes de ${item.rotulo}`}>
                    <dt className="text-slate-500">Situação</dt>
                    <dd className="text-slate-800">{SITUACAO[item.estado] ?? item.estado}</dd>
                    <dt className="text-slate-500">Feito em</dt>
                    <dd className="text-slate-800">{quando(item.criado_em)}</dd>
                    <dt className="text-slate-500">Tentativas com erro</dt>
                    <dd className="text-slate-800">{item.tentativas || 0}</dd>
                    {item.ultimaTentativaEm && (
                      <>
                        <dt className="text-slate-500">Última tentativa</dt>
                        <dd className="text-slate-800">{quando(item.ultimaTentativaEm)}</dd>
                      </>
                    )}
                    {item.motivo && (
                      <>
                        <dt className="text-slate-500">O que aconteceu</dt>
                        <dd className="text-slate-800">{item.motivo}</dd>
                      </>
                    )}
                    {item.detalhes.map((d) => (
                      <React.Fragment key={d.rotulo}>
                        <dt className="text-slate-500">{d.rotulo}</dt>
                        <dd className="break-words text-slate-800">{d.valor}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}

                {/* Ações compactas numa linha só (cabem no celular): Ver detalhes · Excluir · Tentar de novo. */}
                <div className="mt-1.5 flex items-center justify-end gap-1">
                  <button type="button" className={ACAO} aria-expanded={mostrando} onClick={() => setAberto(mostrando ? null : item.id)}>
                    {mostrando ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                    {mostrando ? 'Fechar detalhes' : 'Ver detalhes'}
                  </button>
                  <button type="button" className={`${ACAO} text-red-700`} disabled={ocupado} onClick={() => excluir(item)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Excluir
                  </button>
                  {item.podeTentar && (
                    <button type="button" className={`${ACAO} border-emerald-600 text-emerald-700`} disabled={ocupado || fila.enviando} onClick={() => executar(() => tentarEnviarDeNovo(item.id))}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Tentar de novo
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
