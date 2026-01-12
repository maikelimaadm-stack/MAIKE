import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import JSZip from 'npm:jszip@3.10.1';

function sanitizeRecord(r) {
  if (!r || typeof r !== 'object') return r;
  const copy = { ...r };
  delete copy.id;
  delete copy.created_date;
  delete copy.updated_date;
  delete copy.created_by;
  return copy;
}

async function bulkInsert(base44, entity, records) {
  const BATCH = 500;
  let created = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH).map(sanitizeRecord);
    if (slice.length === 0) continue;
    // usa service role para importar em massa
    await base44.asServiceRole.entities[entity].bulkCreate(slice);
    created += slice.length;
  }
  return created;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { json_url, zip_url, mode = 'append', only_entities, target_empresa_id } = body;

    if (!json_url && !zip_url) {
      return Response.json({ error: 'Provide json_url or zip_url' }, { status: 400 });
    }

    // Obter objeto { data: { Entity: [...] }, schemas? }
    let payload;
    if (json_url) {
      const r = await fetch(json_url);
      if (!r.ok) return Response.json({ error: `Cannot fetch JSON (${r.status})` }, { status: 400 });
      const j = await r.json();
      payload = j.data ? j : { data: j };
    } else {
      const r = await fetch(zip_url);
      if (!r.ok) return Response.json({ error: `Cannot fetch ZIP (${r.status})` }, { status: 400 });
      const buf = await r.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const dataFile = zip.file('data/data.json') || zip.file('data.json');
      if (!dataFile) return Response.json({ error: 'data.json not found in zip' }, { status: 400 });
      const jsonText = await dataFile.async('string');
      const j = JSON.parse(jsonText);
      payload = j.data ? j : { data: j };
    }

    const data = payload.data || {};
    const entities = Object.keys(data).filter((e) => Array.isArray(data[e]));
    const targetEntities = Array.isArray(only_entities) && only_entities.length > 0
      ? entities.filter((e) => only_entities.includes(e))
      : entities;

    const summary = { imported: {}, replaced: {}, errors: {} };

    for (const entity of targetEntities) {
      const records = data[entity] || [];
      if (records.length === 0) continue;

      try {
        const hasEmpresaField = records.some(r => r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'empresa_id'));

        if (mode === 'replace') {
          if (hasEmpresaField && target_empresa_id) {
            await base44.asServiceRole.entities[entity].deleteMany({ empresa_id: target_empresa_id });
            summary.replaced[entity] = 'by_empresa_id';
          } else {
            // Para segurança, não apagamos entidades globais (sem empresa_id)
            // ou quando não foi informado target_empresa_id
            summary.replaced[entity] = hasEmpresaField ? 'skipped_no_target_empresa' : 'skipped_no_empresa_field';
          }
        }

        const recordsForInsert = hasEmpresaField && target_empresa_id
          ? records.map(r => ({ ...r, empresa_id: target_empresa_id }))
          : records;

        const count = await bulkInsert(base44, entity, recordsForInsert);
        summary.imported[entity] = count;
      } catch (e) {
        summary.errors[entity] = String(e?.message || e);
      }
    }

    return Response.json({ status: 'ok', summary });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});