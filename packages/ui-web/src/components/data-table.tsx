import type { ReactNode } from 'react';

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  /** Hücre içeriği; verilmezse row[key] doğrudan basılır. */
  render?: (row: Row) => ReactNode;
  width?: string;
}

export interface DataTableProps<Row> {
  columns: Array<DataTableColumn<Row>>;
  rows: readonly Row[];
  getKey: (row: Row, index: number) => string;
  /** Boş liste yerine gösterilecek durum (örn. EmptyState). */
  empty?: ReactNode;
  /** Ekran okuyucular için tablo açıklaması (caption yerine aria-label). */
  'aria-label'?: string;
  className?: string;
}

/**
 * Kompakt veri tablosu — 48-56px satırlar, başlık üst bilgisi, hover.
 * Veri yoksa tablo yerine `empty` içeriği basılır (asla boş tablo bırakılmaz).
 */
export function DataTable<Row>({
  columns,
  rows,
  getKey,
  empty,
  'aria-label': ariaLabel,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }
  return (
    <div className="tf-table-wrap">
      <table className={`tf-table ${className ?? ''}`.trim()} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={getKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render
                    ? column.render(row)
                    : String((row as Record<string, unknown>)[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
