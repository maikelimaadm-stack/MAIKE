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
    const { json_url, zip_url, mode = 'append', only_entities } = body;

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
        if (mode === 'replace') {
          // apaga todos antes de importar (admin)
          await base44.asServiceRole.entities[entity].deleteMany({});
          summary.replaced[entity] = true;
        }
        const count = await bulkInsert(base44, entity, records);
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