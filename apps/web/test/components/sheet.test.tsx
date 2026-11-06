import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet, Dialog } from '../../src/ui';

function Harness(props: {
  confirmClose?: () => boolean | Promise<boolean>;
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Novo lançamento"
        {...(props.confirmClose ? { confirmClose: props.confirmClose } : {})}
        {...(props.dismissible === false ? { dismissible: false } : {})}
      >
        <input aria-label="Descrição" />
        <button type="button">Lançar</button>
      </BottomSheet>
    </>
  );
}

describe('BottomSheet (UX §5.20)', () => {
  it('abre como diálogo modal nomeado pelo título, foca o conteúdo e trava a rolagem', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Novo lançamento' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Descrição')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    return waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.body.style.overflow).toBe('');
      expect(trigger).toHaveFocus();
    });
  });

  it('foco preso: Tab no último volta ao primeiro e Shift+Tab no primeiro vai ao último', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Fechar' });
    const last = screen.getByRole('button', { name: 'Lançar' });
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    screen.getByLabelText('Descrição').focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByLabelText('Descrição')).toHaveFocus();
  });

  it('Esc e clique fora fecham; confirmClose pode impedir', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Harness confirmClose={confirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('dialog'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('evento cancel do <dialog> nativo passa pelo mesmo caminho; não dispensável ignora', async () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await act(async () => {
      screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    render(<Harness dismissible={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Dialog (UX §5.21)', () => {
  it('destrutivo é alertdialog com foco no botão seguro', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <Dialog
        open
        tone="danger"
        title="Excluir este lançamento?"
        description="Ele sai do mês e do histórico de categorias."
        confirmLabel="Excluir"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Excluir este lançamento?' });
    expect(dialog).toHaveTextContent('Ele sai do mês e do histórico de categorias.');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('escolhas (parcelas) e tom padrão como dialog', () => {
    const onChoose = vi.fn();
    const { rerender } = render(
      <Dialog
        open
        title="Excluir parcela"
        description="Escolha o que fazer com a compra."
        cancelLabel="Voltar"
        options={[
          { value: 'remaining', label: 'Cancelar parcelas restantes' },
          { value: 'all', label: 'Apagar a compra inteira', tone: 'danger' },
        ]}
        onChoose={onChoose}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar a compra inteira' }));
    expect(onChoose).toHaveBeenCalledWith('all');
    rerender(
      <Dialog
        open
        title="Descartar este lançamento?"
        description="O que você digitou será perdido."
        confirmLabel="Descartar"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Descartar este lançamento?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
  });
});
