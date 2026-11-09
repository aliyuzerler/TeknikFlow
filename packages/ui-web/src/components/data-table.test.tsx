import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from './data-table.js';
import { EmptyState } from './states.js';

interface Row {
  code: string;
  customer: string;
  status: string;
}

const COLUMNS: Array<DataTableColumn<Row>> = [
  { key: 'code', header: 'İş emri' },
  { key: 'customer', header: 'Müşteri' },
  { key: 'status', header: 'Durum', render: (row) => <strong>{row.status}</strong> },
];

const ROWS: Row[] = [
  { code: '#TF-0842', customer: 'Marmara Gıda A.Ş.', status: 'Sahada' },
  { code: '#TF-0841', customer: 'Kuzey Plaza', status: 'Parça bekliyor' },
];

describe('DataTable', () => {
  it('başlık ve satırları tablo semantiğiyle basar', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} getKey={(row) => row.code} />);
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'İş emri' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Marmara Gıda A.Ş.' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '#TF-0842' })).toBeInTheDocument();
  });

  it('render fonksiyonu hücre içeriğini özelleştirir', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} getKey={(row) => row.code} />);
    expect(screen.getByText('Sahada').tagName).toBe('STRONG');
  });

  it('aria-label tabloya bağlanır', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getKey={(row) => row.code}
        aria-label="Son iş emirleri"
      />,
    );
    expect(screen.getByRole('table', { name: 'Son iş emirleri' })).toBeInTheDocument();
  });

  it('boş listede tablo yerine boş durum gösterir', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        getKey={(row) => row.code}
        empty={<EmptyState title="Henüz iş emri yok" description="İlk talebi oluşturun." />}
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Henüz iş emri yok')).toBeInTheDocument();
    expect(screen.getByText('İlk talebi oluşturun.')).toBeInTheDocument();
  });

  it('getKey satır kimliğini kararlı üretir', () => {
    const getKey = vi.fn((row: Row, index: number) => `${row.code}-${index}`);
    const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} getKey={getKey} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(getKey).toHaveBeenCalled();
  });
});
