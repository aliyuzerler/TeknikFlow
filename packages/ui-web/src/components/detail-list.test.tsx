import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailList } from './detail-list.js';

describe('DetailList', () => {
  it('dl semantiğiyle etiket/değer çiftlerini gösterir', () => {
    render(
      <DetailList
        label="Varlık bilgileri"
        items={[
          { label: 'Etiket', children: 'AST-DM001' },
          { label: 'Üretici', children: 'Bock' },
        ]}
      />,
    );
    // jsdom dl→role=list eşlemesi yapmaz; etiket özniteliğiyle doğrulanır.
    expect(screen.getByLabelText('Varlık bilgileri')).toBeInTheDocument();
    expect(screen.getByText('AST-DM001')).toBeInTheDocument();
    expect(screen.getByText('Bock')).toBeInTheDocument();
  });

  it('boş değerlerde — gösterir', () => {
    render(
      <DetailList
        label="T"
        items={[
          { label: 'Seri', children: null },
          { label: 'Garanti', children: undefined },
        ]}
      />,
    );
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('tek sütun sınıfı uygulanır', () => {
    const { container } = render(
      <DetailList label="T" columns={1} items={[{ label: 'A', children: 'B' }]} />,
    );
    expect(container.querySelector('.tf-details--stack')).toBeInTheDocument();
  });

  it('react düğümü değer olarak render edilir', () => {
    const strong = <strong>Aktif</strong>;
    render(<DetailList label="T" items={[{ label: 'Durum', children: strong }]} />);
    expect(screen.getByText('Aktif').tagName).toBe('STRONG');
  });
});
