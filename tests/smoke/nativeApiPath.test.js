/**
 * Prefixo `/api/native` — cliente, adaptador Vercel e Fastify.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  comPrefixoApiNativa,
  semPrefixoApiNativa,
  reescreverUrlApiNativa,
  NATIVE_API_PATH_PREFIX,
} from '../../config/nativeApiPath.js';

describe('nativeApiPath — SSOT', () => {
  it('comPrefixoApiNativa não duplica o prefixo', () => {
    expect(comPrefixoApiNativa('/produtos')).toBe(`${NATIVE_API_PATH_PREFIX}/produtos`);
    expect(comPrefixoApiNativa(`${NATIVE_API_PATH_PREFIX}/auth/login`)).toBe(
      `${NATIVE_API_PATH_PREFIX}/auth/login`,
    );
  });

  it('semPrefixoApiNativa preserva paths legados', () => {
    expect(semPrefixoApiNativa(`${NATIVE_API_PATH_PREFIX}/produtos`)).toBe('/produtos');
    expect(semPrefixoApiNativa('/health')).toBe('/health');
    expect(semPrefixoApiNativa(`${NATIVE_API_PATH_PREFIX}`)).toBe('/');
  });

  it('semPrefixoApiNativa não confunde prefixo com /api/nativefake', () => {
    expect(semPrefixoApiNativa('/api/nativefake/produtos')).toBe('/api/nativefake/produtos');
  });

  it('reescreverUrlApiNativa é idempotente e preserva query', () => {
    const url = `${NATIVE_API_PATH_PREFIX}/health?x=1`;
    expect(reescreverUrlApiNativa(url)).toBe('/health?x=1');
    expect(reescreverUrlApiNativa('/health?x=1')).toBe('/health?x=1');
  });

  it('nativeHttpClient monta URL com prefixo', () => {
    const fonte = readFileSync('src/apis/_core/nativeHttpClient.js', 'utf8');
    expect(fonte).toContain('comPrefixoApiNativa');
  });

  it('adaptador Vercel remove prefixo antes do Fastify', () => {
    const fonte = readFileSync('api/fastify.js', 'utf8');
    expect(fonte).toContain('reescreverUrlApiNativa');
  });
});
