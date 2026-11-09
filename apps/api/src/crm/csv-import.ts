import { normalizeEmail, normalizeName } from './crm-utils.js';

/**
 * Faz 04 — müşteri CSV içe aktarma ayrıştırıcısı (saf; birim testleri sınar).
 *
 * Başlık satırı zorunlu, sütun sırası serbest:
 *   name,customerType,taxId,contactName,contactEmail,contactPhone
 *
 * Kurallar:
 * - Tırnak içindeki virgüller ve çift tırnak kaçışı ("") desteklenir.
 * - Satır 2'den başlar (1 = başlık).
 * - Her satır sözcüksel doğrulanır; sonuç {valid|duplicate|error} olur.
 * - Dosya içi tekrarlar (nameNormalized) duplicate işaretlenir.
 */

export interface ParsedCustomerRow {
  row: number;
  name: string;
  customerType: 'COMPANY' | 'INDIVIDUAL';
  taxId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface RowIssue {
  row: number;
  name: string;
  status: 'duplicate' | 'error';
  error?: string;
}

const REQUIRED_COLUMNS = ['name'] as const;
const KNOWN_COLUMNS = new Set([
  'name',
  'customertype',
  'taxid',
  'contactname',
  'contactemail',
  'contactphone',
]);

export interface CsvParseResult {
  rows: ParsedCustomerRow[];
  issues: RowIssue[];
  error?: string;
}

export function parseCustomersCsv(csv: string): CsvParseResult {
  const lines = splitCsvLines(csv);
  if (lines.length === 0) {
    return { rows: [], issues: [], error: 'Dosya boş' };
  }

  const header = parseCsvLine(lines[0] ?? '').map((c) => c.trim().toLowerCase());
  if (header.length === 0 || header.every((c) => c === '')) {
    return { rows: [], issues: [], error: 'Başlık satırı boş' };
  }
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      return { rows: [], issues: [], error: `Eksik zorunlu sütun: ${column}` };
    }
  }
  const unknown = header.filter((c) => c !== '' && !KNOWN_COLUMNS.has(c));
  if (unknown.length > 0) {
    return { rows: [], issues: [], error: `Bilinmeyen sütun(lar): ${unknown.join(', ')}` };
  }

  const indexOf = (column: string): number => header.indexOf(column);
  const idx = {
    name: indexOf('name'),
    customerType: indexOf('customertype'),
    taxId: indexOf('taxid'),
    contactName: indexOf('contactname'),
    contactEmail: indexOf('contactemail'),
    contactPhone: indexOf('contactphone'),
  };

  const rows: ParsedCustomerRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Map<string, number>(); // nameNormalized → ilk satır

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (raw.trim() === '') continue; // boş satırlar atlanır
    const cells = parseCsvLine(raw);
    const row = i + 1; // insana dost satır numarası (1 tabanlı)

    const name = (cells[idx.name] ?? '').trim();
    if (name.length < 2 || name.length > 200) {
      issues.push({ row, name, status: 'error', error: 'Ad 2-200 karakter olmalı' });
      continue;
    }

    const customerTypeRaw = (idx.customerType >= 0 ? (cells[idx.customerType] ?? '') : '')
      .trim()
      .toUpperCase();
    let customerType: 'COMPANY' | 'INDIVIDUAL' = 'COMPANY';
    if (customerTypeRaw === 'INDIVIDUAL' || customerTypeRaw === 'BIREYSEL') {
      customerType = 'INDIVIDUAL';
    } else if (
      customerTypeRaw !== '' &&
      customerTypeRaw !== 'COMPANY' &&
      customerTypeRaw !== 'FIRMA'
    ) {
      issues.push({ row, name, status: 'error', error: 'customerType: COMPANY|INDIVIDUAL olmalı' });
      continue;
    }

    const taxId = (idx.taxId >= 0 ? (cells[idx.taxId] ?? '') : '').trim();
    if (taxId !== '' && !/^[0-9]{10,11}$/.test(taxId)) {
      issues.push({ row, name, status: 'error', error: 'taxId 10-11 rakam olmalı' });
      continue;
    }

    const contactEmail = (idx.contactEmail >= 0 ? (cells[idx.contactEmail] ?? '') : '').trim();
    if (contactEmail !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
      issues.push({ row, name, status: 'error', error: 'Geçersiz kontak e-postası' });
      continue;
    }
    const contactName = (idx.contactName >= 0 ? (cells[idx.contactName] ?? '') : '').trim();
    if (contactName !== '' && contactName.length < 2) {
      issues.push({ row, name, status: 'error', error: 'Kontak adı en az 2 karakter' });
      continue;
    }

    const normalized = normalizeName(name);
    const firstRow = seen.get(normalized);
    if (firstRow !== undefined) {
      issues.push({
        row,
        name,
        status: 'duplicate',
        error: `Satır ${firstRow} ile aynı ad (çift kayıt)`,
      });
      continue;
    }
    seen.set(normalized, row);

    rows.push({
      row,
      name,
      customerType,
      ...(taxId !== '' ? { taxId } : {}),
      ...(contactName !== '' ? { contactName } : {}),
      ...(contactEmail !== '' ? { contactEmail: normalizeEmail(contactEmail) } : {}),
      ...(idx.contactPhone >= 0 && (cells[idx.contactPhone] ?? '').trim() !== ''
        ? { contactPhone: (cells[idx.contactPhone] ?? '').trim() }
        : {}),
    });
  }

  return { rows, issues };
}

/** Satırları ayırır — tırnak içindeki satır sonu yok sayılır (RFC4180 yaklaşımı). */
function splitCsvLines(csv: string): string[] {
  const text = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Tek satırı hücrelere ayırır (tırnak + "" kaçışı). */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
