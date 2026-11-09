import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from './timeline.js';

describe('Timeline', () => {
  const items = [
    { id: '1', title: 'İş emri oluşturuldu', meta: 'Ali · 09:02' },
    { id: '2', title: 'Atandı', meta: 'Ali · 09:20', tone: 'info' as const },
    { id: '3', title: 'Tamamlandı', meta: 'Emre · 16:30', tone: 'success' as const },
  ];

  it('ol semantiğiyle erişilebilir ve ögeleri listeler', () => {
    render(<Timeline label="İş emri zaman çizelgesi" items={items} />);
    expect(screen.getByLabelText('İş emri zaman çizelgesi')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('İş emri oluşturuldu')).toBeInTheDocument();
  });

  it('desc (varsayılan): en yeni önce', () => {
    render(<Timeline label="T" items={items} />);
    const rendered = screen.getAllByRole('listitem');
    expect(rendered[0]).toHaveTextContent('Tamamlandı');
    expect(rendered[2]).toHaveTextContent('İş emri oluşturuldu');
  });

  it('asc: kronolojik sıra', () => {
    render(<Timeline label="T" items={items} order="asc" />);
    const rendered = screen.getAllByRole('listitem');
    expect(rendered[0]).toHaveTextContent('İş emri oluşturuldu');
    expect(rendered[2]).toHaveTextContent('Tamamlandı');
  });

  it('ton sınıfları noktaya uygulanır', () => {
    render(<Timeline label="T" items={items} />);
    expect(document.querySelector('.tf-timeline__item--success')).toBeInTheDocument();
    expect(document.querySelector('.tf-timeline__item--info')).toBeInTheDocument();
    // Belirtilmeyen neutral sınıfı da düşer.
    expect(document.querySelector('.tf-timeline__item--neutral')).toBeInTheDocument();
  });

  it('tanım ve meta satırları render edilir', () => {
    render(
      <Timeline
        label="T"
        items={[
          {
            id: '1',
            title: 'Parça bekleniyor',
            description: 'Eşanjör tedarik süresi 3 iş günü',
            meta: 'Emre · 11:40',
            tone: 'warning',
          },
        ]}
      />,
    );
    expect(screen.getByText('Parça bekleniyor')).toBeInTheDocument();
    expect(screen.getByText('Eşanjör tedarik süresi 3 iş günü')).toBeInTheDocument();
    expect(screen.getByText('Emre · 11:40')).toBeInTheDocument();
  });

  it('boş durum: liste değil mesaj gösterir', () => {
    render(<Timeline label="T" items={[]} emptyMessage="Henüz olay yok" />);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByText('Henüz olay yok')).toBeInTheDocument();
  });

  it('react düğümü başlık/desc/meta olarak render edilir', () => {
    render(
      <Timeline
        label="T"
        items={[
          {
            id: '1',
            title: <strong>Atandı</strong>,
            description: <em>Emre Yılmaz</em>,
            meta: <span>10:00</span>,
          },
        ]}
      />,
    );
    expect(screen.getByText('Atandı').tagName).toBe('STRONG');
    expect(screen.getByText('Emre Yılmaz').tagName).toBe('EM');
  });
});
