import React, { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { B1CartaoCampos, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { AvisoGestao, CampoSelect, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { formatarMoeda } from "@/lib/dinheiroDecimal";
import { PERFIL_PADRAO, ROTULO_LOCALE, ROTULO_PAIS } from "@/services/operacaoFinanceiraService";

/**
 * Perfil financeiro da empresa (§2.1/§8.6): país (só metadado, sem efeito
 * fiscal), moeda (fixa depois do 1º lançamento) e formato de números/datas.
 * Sem perfil não há lançamento. Só o administrador grava; os demais veem o
 * aviso. Padrões EXPLICADOS: Brasil, Real (BRL) e português do Brasil.
 * Desenho do motor Base1 (D-PROD-172): cartão de campos, campos de escolha do
 * motor e os botões verde/cinza do rodapé dos formulários.
 *
 * @param {{
 *   catalogo: { moedas: Array<{ codigo: string, casas: number }>, paises: string[], locales: string[] },
 *   perfilAtual?: { pais: string, moeda: string, locale: string } | null,
 *   podeEditar: boolean,
 *   onSalvar: (dados: { pais: string, moeda: string, locale: string }) => void,
 *   salvando?: boolean,
 *   erro?: string|null,
 *   onFechar?: (() => void) | null,
 * }} props
 */
export default function PerfilFinanceiroPainel({ catalogo, perfilAtual = null, podeEditar, onSalvar, salvando = false, erro = null, onFechar = null }) {
  const [pais, setPais] = useState(perfilAtual?.pais ?? PERFIL_PADRAO.pais);
  const [moeda, setMoeda] = useState(perfilAtual?.moeda ?? PERFIL_PADRAO.moeda);
  const [locale, setLocale] = useState(perfilAtual?.locale ?? PERFIL_PADRAO.locale);
  const casas = catalogo.moedas.find((m) => m.codigo === moeda)?.casas ?? 2;
  const exemplo = formatarMoeda(casas > 0 ? "1234.5" : "1234", { locale, moeda, casas });
  const novo = !perfilAtual;

  if (!podeEditar) {
    return (
      <AvisoGestao testId="perfil-financeiro-aviso">
        {novo
          ? "Esta empresa ainda não tem perfil financeiro (país, moeda e formato). Peça ao administrador da fazenda para configurá-lo; sem ele não há lançamentos."
          : "Somente o administrador da fazenda altera o perfil financeiro."}
      </AvisoGestao>
    );
  }

  return (
    <section data-testid="perfil-financeiro-painel" aria-label="Configurar perfil financeiro da empresa" className="cadastro-b1 mb-2">
      <form
        data-densidade={DENSIDADE_BASE1}
        className="b1 mg-b1-form-grid b1-form-embutido"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!salvando) onSalvar({ pais, moeda, locale });
        }}
      >
        <B1CartaoCampos>
          <SecaoForm titulo={novo ? "Configurar perfil financeiro da empresa" : "Perfil financeiro da empresa"} />
          <div className="col-span-12">
            <AvisoGestao tone="blue">
              {!novo ? <span className="mb-1 block font-semibold">País e formato podem mudar; a moeda fica fixa depois do primeiro lançamento.</span> : null}
              Padrão sugerido: Brasil, Real (BRL) e português do Brasil — o comum para fazendas no Brasil. O país é só informativo (sem efeito fiscal); a moeda vale
              para todos os lançamentos desta empresa e não pode ser trocada depois que houver lançamentos; o formato define como números e datas aparecem e são
              digitados.
            </AvisoGestao>
          </div>
          <CampoSelect
            label="País"
            span={4}
            value={pais}
            onChange={setPais}
            options={catalogo.paises.map((p) => ({ value: p, label: ROTULO_PAIS[/** @type {keyof typeof ROTULO_PAIS} */ (p)] ?? p }))}
          />
          <CampoSelect
            label="Moeda"
            span={4}
            value={moeda}
            onChange={setMoeda}
            options={catalogo.moedas.map((m) => ({ value: m.codigo, label: `${m.codigo} (${m.casas} ${m.casas === 1 ? "casa" : "casas"})` }))}
          />
          <CampoSelect
            label="Formato de números e datas"
            span={4}
            value={locale}
            onChange={setLocale}
            options={catalogo.locales.map((l) => ({ value: l, label: ROTULO_LOCALE[/** @type {keyof typeof ROTULO_LOCALE} */ (l)] ?? l }))}
          />
          <p className="col-span-12 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="perfil-exemplo">
            Exemplo: {exemplo}. {pais === "BR" && moeda === "BRL" ? "Pix fica disponível como forma de pagamento." : "Pix só existe para Brasil com Real."}
          </p>
          {erro ? (
            <p role="alert" className="col-span-12 rounded-md border border-red-200 bg-red-50 p-2 text-[13px] text-red-800">
              {erro}
            </p>
          ) : null}
          <div className="col-span-12 flex flex-wrap items-center justify-end gap-1">
            {onFechar ? (
              <button type="button" className="tb-btn tb-btn-gray" onClick={onFechar} disabled={salvando}>
                <X className="h-4 w-4" aria-hidden />
                Fechar
              </button>
            ) : null}
            <button type="submit" className="tb-btn tb-btn-green" disabled={salvando} data-testid="botao-confirmar-perfil">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {novo ? "Confirmar perfil" : "Salvar perfil"}
            </button>
          </div>
        </B1CartaoCampos>
      </form>
    </section>
  );
}
