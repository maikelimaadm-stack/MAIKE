/**
 * Simulação da fronteira Vercel rewrite → api/fastify.js (PR #105 / #107).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  normalizarIngressoServerlessVercel,
  NATIVE_ROUTE_QUERY_PARAM,
  VERCEL_LEGACY_CAPTURED_PATH_QUERY,
  RotaNativaIngressoInvalidoError,
  validarSegmentosRotaNativa,
} from '../../config/vercelFastifyIngress.js';
import { buildNativeApiRewrites } from '../../scripts/vercel/nativeApiRewriteRules.mjs';
import { NATIVE_API_PATH_PREFIX } from '../../config/nativeApiPath.js';

describe('vercelFastifyIngress — rewrite capturado', () => {
  it('__native_route reconstrói rota e preserva query legítima', () => {
    const entrada = `/api/fastify?${NATIVE_ROUTE_QUERY_PARAM}=empresas&limit=200`;
    expect(normalizarIngressoServerlessVercel(entrada)).toBe('/empresas?limit=200');
  });

  it('PR #107: pathname /api/native/{rota} + __native_route espelhado remove metadado', () => {
    const entrada = `${NATIVE_API_PATH_PREFIX}/empresas?${NATIVE_ROUTE_QUERY_PARAM}=empresas&limit=200`;
    expect(normalizarIngressoServerlessVercel(entrada)).toBe('/empresas?limit=200');
  });

  it('legado Vercel: path injetado é consumido e removido da query', () => {
    const entrada = `/api/fastify?${VERCEL_LEGACY_CAPTURED_PATH_QUERY}=empresas&limit=200`;
    expect(normalizarIngressoServerlessVercel(entrada)).toBe('/empresas?limit=200');
  });

  it('legado em pathname nativo: path coincidente é consumido', () => {
    const entrada = `${NATIVE_API_PATH_PREFIX}/empresas?${VERCEL_LEGACY_CAPTURED_PATH_QUERY}=empresas&limit=200`;
    expect(normalizarIngressoServerlessVercel(entrada)).toBe('/empresas?limit=200');
  });

  it('subpath aninhado (auth/login) preserva segmentos', () => {
    const entrada = `/api/fastify?${NATIVE_ROUTE_QUERY_PARAM}=auth%2Flogin`;
    expect(normalizarIngressoServerlessVercel(entrada)).toBe('/auth/login');
  });

  it('prefixo /api/native direto continua idempotente', () => {
    expect(normalizarIngressoServerlessVercel(`${NATIVE_API_PATH_PREFIX}/health`)).toBe('/health');
  });

  it('prefixo nativo sem metadados preserva filtros reais', () => {
    expect(
      normalizarIngressoServerlessVercel(
        `${NATIVE_API_PATH_PREFIX}/empresas?limit=200&empresa_id=abc`,
      ),
    ).toBe('/empresas?limit=200&empresa_id=abc');
  });

  it('?path= arbitrário em rota já nativa é repassado ao AJV (400 de negócio)', () => {
    expect(normalizarIngressoServerlessVercel(`${NATIVE_API_PATH_PREFIX}/empresas?path=x&limit=1`)).toBe(
      '/empresas?path=x&limit=1',
    );
  });

  it('__native_route contraditório ao pathname rejeita na fronteira', () => {
    expect(() =>
      normalizarIngressoServerlessVercel(
        `${NATIVE_API_PATH_PREFIX}/empresas?${NATIVE_ROUTE_QUERY_PARAM}=fornecedores`,
      ),
    ).toThrow(RotaNativaIngressoInvalidoError);
  });

  it('__native_route duplicado rejeita na fronteira', () => {
    expect(() =>
      normalizarIngressoServerlessVercel(
        `/api/fastify?${NATIVE_ROUTE_QUERY_PARAM}=empresas&${NATIVE_ROUTE_QUERY_PARAM}=fornecedores`,
      ),
    ).toThrow(RotaNativaIngressoInvalidoError);
    expect(() =>
      normalizarIngressoServerlessVercel(
        `${NATIVE_API_PATH_PREFIX}/empresas?${NATIVE_ROUTE_QUERY_PARAM}=empresas&${NATIVE_ROUTE_QUERY_PARAM}=fornecedores`,
      ),
    ).toThrow(RotaNativaIngressoInvalidoError);
  });

  it('rejeita path traversal no segmento capturado', () => {
    expect(() =>
      normalizarIngressoServerlessVercel(`/api/fastify?${NATIVE_ROUTE_QUERY_PARAM}=..%2Fetc`),
    ).toThrow(RotaNativaIngressoInvalidoError);
    expect(() => validarSegmentosRotaNativa('../secret')).toThrow(RotaNativaIngressoInvalidoError);
  });

  it('SSOT rewrite consome :path* no destino', () => {
    const rewrites = buildNativeApiRewrites();
    const apiRule = rewrites.find((r) => r.source === `${NATIVE_API_PATH_PREFIX}/:path*`);
    expect(apiRule?.destination).toBe('/api/fastify?__native_route=:path*');
  });

  it('adaptador Vercel usa normalizador serverless', () => {
    const fonte = readFileSync('api/fastify.js', 'utf8');
    expect(fonte).toContain('normalizarIngressoServerlessVercel');
  });
});
