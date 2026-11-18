/** D-PROD-230 — resposta do assistente com negrito e lista, sem asteriscos e sem HTML. */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import TextoAssistente from '@/components/assistente/TextoAssistente';

afterEach(() => cleanup());

describe('TextoAssistente', () => {
  it('negrito e lista viram elementos; asteriscos somem', () => {
    const { container } = render(
      <TextoAssistente texto={'**4.425 cabeças** em 73 lotes.\n\n**Por categoria:**\n- **Garrote:** 2.061 cabeças\n- Bezerro: 1.400\n### Observações\nTudo certo.'} />,
    );
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('###');
    expect(container.querySelectorAll('strong').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('li strong').textContent).toBe('Garrote:');
  });

  it('HTML no texto não vira HTML', () => {
    const { container } = render(<TextoAssistente texto={'<img src=x onerror=alert(1)> **ok**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
  });
});
