import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plus, Star, Trash } from '@phosphor-icons/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, FAB, IconButton } from '../../src/ui';
import { LONG_PRESS_MS } from '../../src/ui/FAB';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/ui.css'),
  'utf8',
);

afterEach(() => {
  vi.useRealTimers();
});

describe('US-62: alvos de toque ≥ 48 px', () => {
  it.each([
    '.btn',
    '.icon-btn',
    '.card-action',
    '.switch-row',
    '.segmented label',
    '.field-box input',
  ])('%s usa --touch-min (48 px) ou mais', (selector) => {
    const rule = new RegExp(`(^|\\n)${selector.replace(/[.]/g, '\\.')}[^{]*\\{([^}]*)\\}`).exec(
      css,
    );
    expect(rule?.[2]).toMatch(/min-height:\s*(var\(--touch-min\)|4[89]px|5\dpx)/);
  });

  it('FAB e Switch têm 56 px e linha de 48 px', () => {
    expect(css).toMatch(/\.fab \{[^}]*width: 56px;[^}]*height: 56px;/);
    expect(css).toMatch(/\.switch \{[^}]*width: 52px;[^}]*height: 32px;/);
  });
});

describe('Button (UX §5.1)', () => {
  it('papel de botão com o rótulo; variante, tamanho e ícones decorativos', () => {
    const onClick = vi.fn();
    render(
      <Button
        variant="danger"
        size="lg"
        fullWidth
        iconStart={Trash}
        iconEnd={Plus}
        onClick={onClick}
        data-testid="b"
      >
        Excluir lançamento
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Excluir lançamento' });
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'lg');
    expect(button).toHaveAttribute('data-full-width', 'true');
    expect(button).toHaveAttribute('data-testid', 'b');
    expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('desabilitado continua focável, não dispara e lê o motivo', () => {
    const onClick = vi.fn();
    render(
      <Button disabled disabledReason="Informe um valor maior que zero." onClick={onClick}>
        Lançar
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Lançar' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription('Informe um valor maior que zero.');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('desabilitado sem motivo não cria descrição', () => {
    render(<Button disabled>Lançar</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-describedby');
  });

  it('carregando: aria-busy, mantém o rótulo (largura) e não dispara', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Salvar
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.spinner')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('confirmado troca o rótulo pelo Check e anuncia "Salvo"', () => {
    render(<Button confirmed>Salvar</Button>);
    const button = screen.getByRole('button');
    expect(button.querySelector('[data-part="label"]')).toHaveAttribute('data-hidden', 'true');
    expect(button).toHaveTextContent('Salvo');
  });
});

describe('IconButton (UX §5.2)', () => {
  it('rótulo obrigatório vira aria-label; pressed vira aria-pressed', () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconButton icon={Star} label="Favoritar" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Favoritar' });
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button).toHaveAttribute('data-size', '48');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
    rerender(<IconButton icon={Star} label="Favoritar" pressed variant="glass" size={56} />);
    expect(screen.getByRole('button', { name: 'Favoritar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('FAB (UX §5.3)', () => {
  it('"Novo lançamento"; toque abre o Q01', () => {
    const onPress = vi.fn();
    render(<FAB onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo lançamento' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('toque longo abre o menu e não dispara o toque comum', () => {
    vi.useFakeTimers();
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    render(<FAB onPress={onPress} onLongPress={onLongPress} />);
    const fab = screen.getByRole('button', { name: 'Novo lançamento' });
    expect(fab).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.pointerDown(fab);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(fab);
    fireEvent.click(fab);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.pointerDown(fab);
    fireEvent.pointerLeave(fab);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.click(fab);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
