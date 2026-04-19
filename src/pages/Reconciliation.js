import React, { useState } from 'react';

const HEADERS = [
  'Reklam yayıcısının adı',
  'VÖEN',
  'İcazə',
  'Elektron qaimənin tarixi',
  'Elektron qaimənin nömrəsi',
  'EQ məbləği(əsas)',
  'EQ məbləği(ƏDV)',
  'Ödəniş tarixi',
  'Ödəniş məbləği(Əsas)',
  'Ödəniş tarixi(ƏDV)',
  'Ödəniş məbləği(ƏDV)',
  'Qeyd',
];

const COL_WIDTHS = [38, 16, 16, 18, 24, 16, 16, 14, 16, 14, 16, 18];

const STATUS_COLOR = {
  'TAM ÖDƏNİLİB': 'FFD9EAD3',
  'ARTIQ ÖDƏNİŞ': 'FFFCE5CD',
};
const BASE_FONT = { name: 'Arial', size: 10 };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6D4' } };
const GRID_BORDER = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

export default function Reconciliation({ api }) {
  const [loading, setLoading] = useState(false);

  const exportExcel = async () => {
    setLoading(true);
    try {
      const [{ default: ExcelJS }, res] = await Promise.all([
        import('exceljs'),
        fetch(`${api}/api/reconciliation`),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Allocation');
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const headerRow = ws.addRow(HEADERS);
      headerRow.height = 28;
      headerRow.eachCell((cell, colNumber) => {
        cell.font = { ...BASE_FONT, bold: true };
        cell.fill = HEADER_FILL;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = GRID_BORDER;
        if (colNumber === 3) {
          cell.font = { ...BASE_FONT, bold: true, color: { argb: 'FFFF0000' } };
        }
      });
      ws.columns.forEach((col, i) => { col.width = COL_WIDTHS[i] || 14; });

      rows.forEach(row => {
        const r = ws.addRow([
          row.reklamYayicisi,
          row.voen,
          row.icazeNo,
          row.eqTarixi,
          row.eqNomresi,
          row.eqMeblegEsas || '',
          row.eqMeblegEdv || '',
          row.odenisTarixi || '',
          row.odenisMeblegEsas || '',
          row.odenisTarixiEdv || '',
          row.odenisMeblegEdv || '',
          row.qeyd || '',
        ]);
        r.height = 22;
        r.eachCell((cell, colNumber) => {
          cell.font = { ...BASE_FONT };
          cell.alignment = {
            vertical: 'middle',
            horizontal: colNumber === 1 ? 'left' : 'center',
            wrapText: true,
          };
          cell.border = GRID_BORDER;
        });
        const color = STATUS_COLOR[row.status];
        if (color) {
          r.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
            if (row.status === 'ARTIQ ÖDƏNİŞ') cell.font = { ...BASE_FONT, italic: true, bold: true, strike: true };
          });
        }
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `allocation_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
    } catch (e) { console.error(e); alert('Export xətası: ' + e.message); }
    setLoading(false);
  };

  return (
    <div>
      <div className="module-header">
        <div className="module-title"><span>03</span> — Rekonsiliasiya · Allokasiya</div>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={exportExcel} disabled={loading}>
            {loading ? 'Hazırlanır...' : '⬇ Excel Export'}
          </button>
        </div>
      </div>
      <div className="empty-state" style={{ marginTop: 80 }}>
        <div className="es-icon">📊</div>
        <p>Bank medaxilləri <b>Müraciət № / EQF №</b> ilə İCAZƏ üzrə qaimələrə FIFO allokasiya olunur.</p>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
          🟢 TAM ÖDƏNİLİB &nbsp;·&nbsp; ⚪ QİSMƏN ÖDƏNİLİB &nbsp;·&nbsp; ⚪ ÖDƏNİLMƏYİB &nbsp;·&nbsp; 🟠 ARTIQ ÖDƏNİŞ
        </p>
      </div>
    </div>
  );
}
