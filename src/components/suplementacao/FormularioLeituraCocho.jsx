import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import LancField from "@/components/cadastro/base1/LancField";
import { LancLoteForm, LancLoteSegmento, LancLoteAviso, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { registrarLeituraCocho } from "@/services/leituraCochoService";
import { refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { ACESSOS, ESCORES, ESTRUTURAS, ROTULO_ACESSO, ROTULO_ESCORE, ROTULO_ESTRUTURA } from "@/domain/suplementacao/leituraCocho";

const opcoes = (valores, rotulos) => valores.map((v) => ({ value: v, label: rotulos[v] }));

/**
 * D-PROD-205 — Leitura de cocho: o que se viu no cocho num dia (escore, acesso e
 * estrutura). NÃO movimenta estoque. Funciona sem rede: a leitura entra na fila
 * offline e vai ao servidor quando a conexão voltar.
 *
 * @param {{ ponto: any, hoje: string, onCancel: () => void, onSaved?: (leitura: any) => void }} props
 *   `hoje`: dia civil da fazenda (AAAA-MM-DD), padrão e teto da data.
 */
export default function FormularioLeituraCocho({ ponto, hoje, onCancel, onSaved }) {
  const [form, setForm] = useState({ data_leitura: hoje, escore: "", acesso: "BOM", estrutura: "BOA", observacoes: "" });
  const [salvando, setSalvando] = useState(false);
  const muda = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const enviar = async (e) => {
    e?.preventDefault?.();
    if (salvando) return;
    if (!form.escore) {
      notifyWarning("Atenção", "Escolha o escore do cocho (Vazio, Adequado ou Cheio).");
      return;
    }
    if (!form.data_leitura || (hoje && form.data_leitura > hoje)) {
      notifyWarning("Atenção", "A data da leitura não pode ser depois de hoje.");
      return;
    }
    setSalvando(true);
    try {
      const corpo = {
        empresa_id: ponto.empresa_id,
        ponto_suplementacao_id: ponto.id,
        data_leitura: form.data_leitura,
        escore: form.escore,
        acesso: form.acesso,
        estrutura: form.estrutura,
        observacoes: form.observacoes.trim() || null,
      };
      const leitura = await registrarLeituraCocho(corpo);
      const registro = { ...corpo, ...(leitura || {}) };
      await updateMapaCachedData("leiturasCocho", ponto.empresa_id, (itens) => [registro, ...(itens || []).filter((i) => i.id !== registro.id)]);
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        refreshMapaCacheEntry("leiturasCocho", ponto.empresa_id, { force: true }).catch(() => {});
      }
      notifySuccess("Leitura registrada", registro._isOffline ? "Sem conexão: a leitura vai ao servidor quando a rede voltar." : undefined);
      onSaved?.(registro);
    } catch (erro) {
      notifyError("Erro ao registrar a leitura", getApiErrorMessage(erro));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <LancLoteForm onSubmit={enviar} data-testid="form-leitura-cocho">
      <LancField label="Data da Leitura" required>
        <Input
          type="date"
          value={form.data_leitura}
          max={hoje || undefined}
          onChange={(e) => muda("data_leitura")(e.target.value)}
          className={LL_CTL}
          required
        />
      </LancField>
      <LancLoteSegmento rotulo="Escore do cocho" required name="escore" opcoes={opcoes(ESCORES, ROTULO_ESCORE)} valor={form.escore} onChange={muda("escore")} />
      <LancLoteSegmento rotulo="Acesso" name="acesso" opcoes={opcoes(ACESSOS, ROTULO_ACESSO)} valor={form.acesso} onChange={muda("acesso")} />
      <LancLoteSegmento rotulo="Estrutura" name="estrutura" opcoes={opcoes(ESTRUTURAS, ROTULO_ESTRUTURA)} valor={form.estrutura} onChange={muda("estrutura")} />
      <LancField label="Observação">
        <textarea
          value={form.observacoes}
          maxLength={2000}
          rows={2}
          onChange={(e) => muda("observacoes")(e.target.value)}
          className="w-full resize-y bg-transparent px-2 py-1 text-xs outline-none"
        />
      </LancField>
      <LancLoteAviso tom="neutro">A leitura não mexe no estoque: só registra o que se viu no cocho.</LancLoteAviso>
      <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={salvando} textoAcao="Registrar Leitura" textoEnviando="Salvando..." enviando={salvando} />
    </LancLoteForm>
  );
}
