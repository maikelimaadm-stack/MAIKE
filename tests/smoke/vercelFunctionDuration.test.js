/**
 * D-PROD-155 (P3-01, R4): prazo EXPLÍCITO da função da API na Vercel.
 *
 * A tela da Central Única dá 60 s aos comandos (confirmar, cancelar, liquidar,
 * estornar) e o servidor segura a transação por até 30 s + 10 s de espera de
 * conexão. Sem `functions` no vercel.json, o prazo efetivo dependeria do padrão
 * do plano e do Fluid Compute, que não são legíveis pelo conector. Com o valor
 * explícito, o prazo fica determinado pelo repositório: ≥ 60 s e dentro do
 * máximo do plano Pro (300 s sem Fluid; 800 s com Fluid).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const raiz = process.cwd();
const vercel = JSON.parse(readFileSync(join(raiz, 'vercel.json'), 'utf8'));

describe('VERCEL-DUR — prazo explícito da função da API', () => {
  it('api/fastify.js existe e tem maxDuration explícito entre 60 e 300 s', () => {
    expect(existsSync(join(raiz, 'api', 'fastify.js'))).toBe(true);
    const cfg = vercel.functions?.['api/fastify.js'];
    expect(cfg, 'vercel.json precisa declarar functions["api/fastify.js"]').toBeTruthy();
    expect(Number.isInteger(cfg.maxDuration)).toBe(true);
    expect(cfg.maxDuration).toBeGreaterThanOrEqual(60);
    expect(cfg.maxDuration).toBeLessThanOrEqual(300);
  });

  it('o prazo da função cobre a maior espera do servidor (30 s de transação + 10 s de conexão)', () => {
    expect(vercel.functions['api/fastify.js'].maxDuration).toBeGreaterThanOrEqual(30 + 10);
  });

  it('a sincronização dos rewrites preserva a chave functions', () => {
    const fonte = readFileSync(join(raiz, 'scripts', 'vercel', 'sync-vercel-json.mjs'), 'utf8');
    expect(fonte).toMatch(/\.\.\.atual/);
  });
});
