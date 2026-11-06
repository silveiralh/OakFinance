import { fireEvent, render, screen } from '@testing-library/react';
import { Search, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, Select, Switch, TextField } from '../../src/ui';

function ControlledField(props: { error?: string; hint?: string }) {
  const [value, setValue] = useState('mercado');
  return (
    <TextField
      label="Buscar"
      value={value}
      onChange={setValue}
      clearable
      prefixIcon={Search}
      {...props}
    />
  );
}

function ControlledSwitch() {
  const [on, setOn] = useState(false);
  return (
    <Switch
      label="Ocultar valores"
      description="Também nas notificações"
      checked={on}
      onChange={setOn}
    />
  );
}

function ControlledSegmented() {
  const [v, setV] = useState<'expense' | 'income'>('expense');
  return (
    <SegmentedControl
      label="Tipo"
      value={v}
      onChange={setV}
      options={[
        { value: 'expense', label: 'Despesa', icon: TrendingDown },
        { value: 'income', label: 'Receita', icon: TrendingUp },
      ]}
    />
  );
}

describe('TextField, Select e Switch (UX §5.14)', () => {
  it('rótulo associado, dica como descrição e botão Limpar', () => {
    render(<ControlledField hint="Descrição ou valor" />);
    const input = screen.getByLabelText('Buscar');
    expect(input).toHaveValue('mercado');
    expect(input).toHaveAccessibleDescription('Descrição ou valor');
    expect(input).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Limpar' })).toBeNull();
    fireEvent.change(input, { target: { value: 'posto' } });
    expect(input).toHaveValue('posto');
  });

  it('erro: aria-invalid, descrição com o texto e ícone', () => {
    render(<ControlledField error="Escolha uma categoria." hint="não aparece" />);
    const input = screen.getByLabelText('Buscar');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Escolha uma categoria.');
    expect(screen.queryByText('não aparece')).toBeNull();
  });

  it('Select nativo com o mesmo rótulo e mudança', () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Conta"
        value="bb"
        onChange={onChange}
        error="Escolha uma conta."
        options={[
          { value: 'bb', label: 'BB' },
          { value: 'nu', label: 'Nubank' },
        ]}
      />,
    );
    const select = screen.getByLabelText('Conta');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(select, { target: { value: 'nu' } });
    expect(onChange).toHaveBeenCalledWith('nu');
  });

  it('Switch com papel switch, aria-checked e ícone quando ligado', () => {
    render(<ControlledSwitch />);
    const sw = screen.getByRole('switch', { name: 'Ocultar valores' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription('Também nas notificações');
    expect(sw.querySelector('svg')).toBeNull();
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw.querySelector('svg')).not.toBeNull();
  });
});

describe('SegmentedControl (UX §5.9)', () => {
  it('grupo de rádios com rótulo; a opção marcada e a troca', () => {
    render(<ControlledSegmented />);
    expect(screen.getByRole('group', { name: 'Tipo' })).toBeInTheDocument();
    const expense = screen.getByRole('radio', { name: 'Despesa' });
    const income = screen.getByRole('radio', { name: 'Receita' });
    expect(expense).toBeChecked();
    fireEvent.click(income);
    expect(income).toBeChecked();
    expect(expense).not.toBeChecked();
    expect(income.closest('label')).toHaveAttribute('data-checked', 'true');
  });
});
