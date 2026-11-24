import React, { useState } from 'react';
import { CloudUpload, AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFilaDeEnvio } from '@/hooks/useFilaDeEnvio';
import { enviarAgora, tentarEnviarDeNovo, descartarRegistroNaoEnviado } from '@/services/sincronizacaoService';
import { confirmar } from '@/lib/maikeConfirmar';

const quando = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * D-PROD-295 — "Envio": o que foi feito sem internet e ainda não chegou ao
 * sistema. Fica dentro da janela "Dados sem internet" (sem aviso na tela).
 *
 * - aguardando envio: sai sozinho quando houver internet;
 * - precisa de atenção: o sistema recusou; mostra o motivo, e a pessoa tenta
 *   de novo (depois de corrigir) ou descarta. Nada sai daqui sem ela decidir.
 */
export default function FilaDeEnvio() {
  const fila = useFilaDeEnvio();
  const [ocupado, setOcupado] = useState(false);

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

  const descartar = async (item) => {
    const ok = await confirmar({
      titulo: 'Descartar este registro?',
      descricao: `"${item.rotulo}" não vai chegar ao sistema. Isso não pode ser desfeito.`,
      textoConfirmar: 'Descartar',
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
        <ul className="max-h-56 space-y-1.5 overflow-y-auto">
          {fila.itens.map((item) => (
            <li key={item.id} className={`rounded-md border px-2.5 py-2 text-sm ${item.estado === 'atencao' ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
              <div className="flex items-start gap-1.5">
                {item.estado === 'atencao' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                ) : (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{item.rotulo}</p>
                  <p className="text-xs text-slate-500">Feito em {quando(item.criado_em)}</p>
                  {item.estado === 'atencao' && item.ultimo_erro && (
                    <p className="mt-0.5 text-xs text-amber-800">{item.ultimo_erro.mensagem}</p>
                  )}
                </div>
              </div>
              {item.estado === 'atencao' && (
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <Button type="button" size="sm" variant="ghost" disabled={ocupado} onClick={() => descartar(item)}>
                    Descartar
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => executar(() => tentarEnviarDeNovo(item.id))}>
                    Tentar de novo
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {fila.outrosAguardando > 0 && (
        <p className="text-xs text-slate-500">Inclui {fila.outrosAguardando} alteração(ões) de cadastro feitas sem internet.</p>
      )}
    </div>
  );
}
