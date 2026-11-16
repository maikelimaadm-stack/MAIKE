import React, { useEffect, useState } from "react";
import { listarSetoresAtivos, criarArea, atualizarArea } from "@/services/mapaService";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  areaHectares,
  toPersistedCoords,
  parseVertices,
  inspectVertices,
  validatePolygonForSave,
} from "@/lib/geografia";

import { toast } from "sonner";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import CapturaGPSPoligono from "./CapturaGPSPoligono";
import {
  APROVEITAMENTO,
  CORES_DISPONIVEIS as CORES_CADASTRO,
  TIPOS_CULTURAS,
  TIPOS_INFRAESTRUTURA,
  TIPOS_USO,
  lerHectares,
  lerHectaresDigitados,
  pendenciasDaArea,
  usoExploraArea,
} from "@/domain/areas/regrasCadastroArea";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

// Listas e regras compartilhadas com a importação por arquivo (D-PROD-90).
const CORES_DISPONIVEIS = CORES_CADASTRO;

export const FORMULARIO_AREA_ID = "formulario-area-b1";

/**
 * Hectares no formato da tela (pt-BR): o número 10.5 da API vira "10,50". Sempre com
 * vírgula (mínimo 2 casas), para o leitor nunca confundir o ponto de milhar com decimal.
 * @param {unknown} val
 * @param {number} [maxCasas] casas decimais máximas (a coluna guarda até 4)
 */
const formatHa = (val, maxCasas = 2) => {
  if (!val && val !== 0) return '';
  const num = typeof val === 'number' ? val : lerHectares(val);
  if (typeof num !== 'number' || Number.isNaN(num)) return String(val);
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: maxCasas });
};

/**
 * Tipo de infraestrutura de uma área gravada. Não há coluna própria: o servidor
 * guarda o tipo em `tipo_pastagem` (regrasCadastroArea.js), então a edição lê de lá
 * — o mesmo fallback do catálogo do mapa e de `ehCurral`.
 */
const tipoInfraestruturaDoItem = (item) => {
  if (item?.tipo_infraestrutura) return item.tipo_infraestrutura;
  if (item?.tipo_cultura !== 'Infraestrutura') return '';
  const tipo = String(item?.tipo_pastagem || '').trim();
  return TIPOS_INFRAESTRUTURA.find((t) => t.toLowerCase() === tipo.toLowerCase()) || tipo;
};

/**
 * Detalhes da área (D-PROD-174: campos e listas do motor Base1).
 * `layout="painel"` (padrão): o painel do desenho no mapa, uma coluna, com Cancelar/Salvar.
 * `layout="registro"`: o registro do Cadastro de Áreas; quem salva é a barra do motor (form `formId`),
 * e `readOnly` mostra os campos travados até o "Editar".
 */
export default function FormularioArea({
  coordenadas,
  onSave = (gravada) => void gravada,
  onCancel = () => {},
  usarGPS = false,
  item,
  onCorChange = null,
  layout = "painel",
  formId = FORMULARIO_AREA_ID,
  readOnly = false,
  onSalvandoChange = null,
}) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState({
    nome: item?.nome || "",
    sigla: item?.sigla || "",
    numero_area: item?.numero_area || "",
    setor_id: item?.setor_id || "",
    setor_nome: item?.setor_nome || "",
    area_total: item?.tamanho_hectares?.toString() || "",
    area_pastejada: item?.area_pastejada != null && item?.area_pastejada !== "" ? formatHa(item.area_pastejada, 4) : "",
    aproveitamento: item?.aproveitamento_classificacao || "Média",
    tipo_cultura: item?.tipo_cultura || "Pastagem",
    // Em Infraestrutura, `tipo_pastagem` gravado é o tipo da infraestrutura (vai para o campo
    // abaixo); no estado do formulário fica o marcador que a troca de uso já usa.
    tipo_pastagem: item?.tipo_cultura === "Infraestrutura" ? "Infraestrutura" : item?.tipo_pastagem || "",
    tipo_infraestrutura: tipoInfraestruturaDoItem(item),
    cor: item?.cor || item?.coordenadas?.cor || CORES_DISPONIVEIS[4].cor,
    observacoes: item?.observacoes || "",
  });

  // Prévia no mapa acompanha a cor escolhida antes de salvar (D-PROD-67); opcional.
  useEffect(() => {
    onCorChange?.(formData.cor);
  }, [formData.cor, onCorChange]);

  const { data: setores = [] } = useQuery({
    queryKey: ["setores-form-area", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarSetoresAtivos(empresaSelecionadaId);
      return all.filter((setor) => setor.empresa_id === empresaSelecionadaId && setor.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const handleChange = (field, value) => { setFormData((prev) => ({ ...prev, [field]: value })); setInvalidFields((prev) => prev.filter((item) => item !== field)); };

  const createAreaMutation = useMutation({
    /** @param {Record<string, any>} data */
    mutationFn: async (data) => {
      if (item) {
        return atualizarArea(item.id, {
          ...data,
          coordenadas: {
            coords: toPersistedCoords(coordenadasGPS || coordenadas || item.coordenadas?.coords),
            cor: data.cor,
          },
        });
      }
      // `numero_area` e `setor_nome` são do servidor (sequência e linha do
      // setor); o cliente não calcula nem envia (D-PROD-31, D-PROD-90 R1).
      return criarArea({
        ...data,
        empresa_id: empresaSelecionadaId,
        quantidade_atual: 0,
        status_ocupacao: 'Disponível',
        ativo: true,
        coordenadas: { coords: toPersistedCoords(coordenadasGPS || coordenadas), cor: data.cor },
      });
    },
    onSuccess: (gravada) => { toast.success(item ? "Área atualizada!" : "Área cadastrada!"); onSave(gravada); },
    onError: () => { toast.error(item ? "Erro ao atualizar área" : "Erro ao cadastrar área"); },
  });

  useEffect(() => {
    onSalvandoChange?.(createAreaMutation.isPending);
  }, [createAreaMutation.isPending, onSalvandoChange]);

  const handleCapturaGPS = (pontos) => { setCoordenadasGPS(pontos); setMostrarCapturaGPS(false); toast.success(`${pontos.length} pontos capturados via GPS!`); };

  React.useEffect(() => {
    const coords = parseVertices(coordenadasGPS || coordenadas);
    if (coords.length >= 3) {
      const areaHa = areaHectares(coords);
      setFormData((prev) => ({ ...prev, area_total: formatHa(areaHa) }));
    }
  }, [coordenadasGPS, coordenadas]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const infraestrutura = formData.tipo_cultura === 'Infraestrutura';
    // "1.234,56" e "1.500" (pt-BR, ponto de milhar) e "10.5" (ponto decimal do teclado):
    // "1.500" é 1500 ha, como nos demais formulários; "10.5" continua 10,5.
    const haDigitado = (valor) => lerHectaresDigitados(valor);
    // Mesma regra da importação por arquivo (D-PROD-90): Reserva/APP não exigem
    // cultura e aceitam 0 de pastejada; pastejada nunca passa da área total.
    const pendencias = pendenciasDaArea({
      nome: formData.nome,
      setor_id: formData.setor_id,
      tipo_cultura: formData.tipo_cultura,
      tipo_pastagem: infraestrutura ? formData.tipo_infraestrutura : formData.tipo_pastagem,
      area_pastejada: infraestrutura ? null : haDigitado(formData.area_pastejada),
      total_ha: infraestrutura ? null : haDigitado(formData.area_total),
    });
    const missing = pendencias.map((p) => p.campo);
    if (!infraestrutura && !formData.area_total) missing.push("area_total");
    if (missing.length) {
      setInvalidFields(missing);
      const outra = pendencias.find((p) => !/^(Informe|Escolha)/.test(p.mensagem));
      toast.error(outra ? outra.mensagem : "Preencha os campos obrigatórios.");
      return;
    }

    const rawCoords = coordenadasGPS || coordenadas || item?.coordenadas?.coords;
    const inspected = inspectVertices(rawCoords);
    if (Array.isArray(rawCoords) && inspected.invalidCount > 0) {
      toast.error(
        `Não é possível salvar: ${inspected.invalidCount} vértice(s) inválido(s) na geometria. Corrija no mapa antes de sobrescrever.`
      );
      return;
    }
    const coords = inspected.vertices.length ? inspected.vertices : parseVertices(rawCoords);
    const polyCheck = validatePolygonForSave(coords);
    if (!polyCheck.ok && formData.tipo_cultura !== "Infraestrutura") {
      toast.error(polyCheck.reason || "Polígono inválido");
      return;
    }
    let tamanhoHectares = 0;
    if (coords.length >= 3) {
      tamanhoHectares = parseFloat(areaHectares(coords).toFixed(2));
    }
    const totalDigitado = haDigitado(formData.area_total);
    const pastejadaDigitada = haDigitado(formData.area_pastejada);

    createAreaMutation.mutate({
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla?.toUpperCase(),
      setor_id: formData.setor_id,
      aproveitamento_classificacao: formData.aproveitamento,
      tipo_cultura: formData.tipo_cultura,
      tipo_pastagem: formData.tipo_cultura === 'Infraestrutura' ? formData.tipo_infraestrutura : formData.tipo_pastagem,
      tipo_infraestrutura: formData.tipo_cultura === 'Infraestrutura' ? formData.tipo_infraestrutura : undefined,
      tamanho_hectares: formData.tipo_cultura === 'Infraestrutura' ? 0 : (Number.isFinite(totalDigitado) && totalDigitado) || tamanhoHectares,
      area_pastejada: formData.tipo_cultura === 'Infraestrutura' ? 0 : (Number.isFinite(pastejadaDigitada) ? pastejadaDigitada : 0),
      observacoes: formData.observacoes?.toUpperCase(),
      cor: formData.cor,
    });
  };

  if (mostrarCapturaGPS) {
    return <CapturaGPSPoligono tipo="area" onSalvar={handleCapturaGPS} onCancelar={() => { setMostrarCapturaGPS(false); if (usarGPS) onCancel(); }} />;
  }

  const registro = layout === "registro";
  /** Largura do campo: no registro, a grade do motor; no painel do desenho, uma coluna. */
  const larg = (n) => (registro ? n : 12);
  const infraestrutura = formData.tipo_cultura === "Infraestrutura";
  const bloqueado = readOnly || createAreaMutation.isPending;
  const erro = (campo) => (invalidFields.includes(campo) ? "Obrigatório" : undefined);
  const nomeDoSetor = setores.find((s) => s.id === formData.setor_id)?.nome || formData.setor_nome || "";

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      className={`b1 mg-b1-form-grid w-full min-h-0 ${registro ? "" : "mt-1"}`}
      noValidate
      data-testid="b1-form-area"
      data-densidade={DENSIDADE_BASE1}
    >
      {!infraestrutura && (
        <>
          <B1Field label="Área total (ha)" required span={larg(3)} hasValue={Boolean(formData.area_total)} locked error={erro("area_total")}>
            <input type="text" value={formData.area_total} readOnly className={B1_FIELD_CTL_CLS} />
          </B1Field>
          <B1Field
            label="Área pastejada ou arável (ha)"
            required
            span={larg(3)}
            hasValue={Boolean(formData.area_pastejada)}
            locked={readOnly}
            disabled={bloqueado && !readOnly}
            error={erro("area_pastejada")}
          >
            <input
              type="text"
              inputMode="decimal"
              value={formData.area_pastejada}
              onChange={(e) => handleChange("area_pastejada", e.target.value)}
              className={B1_FIELD_CTL_CLS}
              readOnly={readOnly}
            />
          </B1Field>
        </>
      )}

      <B1Field label="Nome" required span={larg(infraestrutura ? 8 : 4)} hasValue={Boolean(formData.nome)} locked={readOnly} error={erro("nome")}>
        <input
          type="text"
          value={formData.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field label="Sigla" span={larg(infraestrutura ? 4 : 2)} hasValue={Boolean(formData.sigla)} locked={readOnly}>
        <input
          type="text"
          value={formData.sigla}
          onChange={(e) => handleChange("sigla", e.target.value.toUpperCase())}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          maxLength={10}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field label="Setor" required span={larg(4)} hasValue={Boolean(formData.setor_id)} locked={readOnly} error={erro("setor_id")}>
        {readOnly ? (
          <input type="text" readOnly value={nomeDoSetor.toUpperCase()} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            aria-label="Setor"
            value={formData.setor_id || ""}
            onChange={(e) => {
              const setor = setores.find((s) => s.id === e.target.value);
              handleChange("setor_id", e.target.value);
              handleChange("setor_nome", setor?.nome || "");
            }}
            className={B1_FIELD_CTL_CLS}
            pesquisa="sempre"
            semOpcaoVazia
            maiusculas
          >
            {setores.map((setor) => (
              <option key={setor.id} value={setor.id}>
                {setor.nome}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      <B1Field label="Tipo de uso" required span={larg(4)} hasValue={Boolean(formData.tipo_cultura)} locked={readOnly}>
        {readOnly ? (
          <input type="text" readOnly value={String(formData.tipo_cultura || "").toUpperCase()} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            aria-label="Tipo de uso"
            value={formData.tipo_cultura}
            onChange={(e) => {
              const v = e.target.value;
              setFormData((prev) => ({
                ...prev,
                tipo_cultura: v,
                tipo_pastagem: v === "Infraestrutura" ? "Infraestrutura" : prev.tipo_pastagem === "Infraestrutura" ? "" : prev.tipo_pastagem,
                tipo_infraestrutura: v === "Infraestrutura" ? prev.tipo_infraestrutura : "",
              }));
            }}
            className={B1_FIELD_CTL_CLS}
            pesquisa="sempre"
            semOpcaoVazia
            maiusculas
          >
            {TIPOS_USO.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      {infraestrutura ? (
        <B1Field
          label="Tipo de infraestrutura"
          required
          span={larg(4)}
          hasValue={Boolean(formData.tipo_infraestrutura)}
          locked={readOnly}
          error={erro("tipo_infraestrutura")}
        >
          {readOnly ? (
            <input type="text" readOnly value={String(formData.tipo_infraestrutura || "").toUpperCase()} className={B1_FIELD_CTL_CLS} />
          ) : (
            <B1Select
              aria-label="Tipo de infraestrutura"
              value={formData.tipo_infraestrutura || ""}
              onChange={(e) => handleChange("tipo_infraestrutura", e.target.value)}
              className={B1_FIELD_CTL_CLS}
              pesquisa="sempre"
              semOpcaoVazia
              maiusculas
            >
              {TIPOS_INFRAESTRUTURA.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </B1Select>
          )}
        </B1Field>
      ) : (
        <>
          <B1Field
            label="Tipo de cultura"
            required={usoExploraArea(formData.tipo_cultura)}
            span={larg(4)}
            hasValue={Boolean(formData.tipo_pastagem)}
            locked={readOnly}
            error={erro("tipo_pastagem")}
          >
            {readOnly ? (
              <input type="text" readOnly value={String(formData.tipo_pastagem || "").toUpperCase()} className={B1_FIELD_CTL_CLS} />
            ) : (
              <B1Select
                aria-label="Tipo de cultura"
                value={formData.tipo_pastagem || ""}
                onChange={(e) => handleChange("tipo_pastagem", e.target.value)}
                className={B1_FIELD_CTL_CLS}
                pesquisa="sempre"
                semOpcaoVazia
                maiusculas
              >
                {usoExploraArea(formData.tipo_cultura) ? null : <option value="" />}
                {TIPOS_CULTURAS.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </B1Select>
            )}
          </B1Field>

          <B1Field label="Aproveitamento" span={larg(4)} hasValue={Boolean(formData.aproveitamento)} locked={readOnly}>
            {readOnly ? (
              <input type="text" readOnly value={String(formData.aproveitamento || "").toUpperCase()} className={B1_FIELD_CTL_CLS} />
            ) : (
              <B1Select
                aria-label="Aproveitamento"
                value={formData.aproveitamento}
                onChange={(e) => handleChange("aproveitamento", e.target.value)}
                className={B1_FIELD_CTL_CLS}
                pesquisa="sempre"
                semOpcaoVazia
                maiusculas
              >
                {APROVEITAMENTO.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </B1Select>
            )}
          </B1Field>
        </>
      )}

      <B1Field label="Cor no mapa" span={larg(4)} hasValue={Boolean(formData.cor)} locked={readOnly}>
        <div className="flex w-full min-w-0 items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full border border-slate-300" style={{ backgroundColor: formData.cor }} />
          {readOnly ? (
            <input
              type="text"
              readOnly
              value={String(CORES_DISPONIVEIS.find((c) => c.cor === formData.cor)?.nome || "").toUpperCase()}
              className={B1_FIELD_CTL_CLS}
            />
          ) : (
            <B1Select
              aria-label="Cor no mapa"
              value={formData.cor}
              onChange={(e) => handleChange("cor", e.target.value)}
              className={B1_FIELD_CTL_CLS}
              pesquisa="sempre"
              semOpcaoVazia
              maiusculas
            >
              {CORES_DISPONIVEIS.map((c) => (
                <option key={c.cor} value={c.cor}>
                  {c.nome}
                </option>
              ))}
            </B1Select>
          )}
        </div>
      </B1Field>

      <B1Field label="Observação" span={12} hasValue={Boolean(formData.observacoes)} locked={readOnly}>
        <textarea
          value={formData.observacoes}
          onChange={(e) => handleChange("observacoes", e.target.value)}
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>

      {registro ? null : (
        <div className="col-span-12">
          <CadastroFormActions onCancel={onCancel} submitLabel="Salvar" isSubmitting={createAreaMutation.isPending} />
        </div>
      )}
    </form>
  );
}