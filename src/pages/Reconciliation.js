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

      const headerRow = ws.addRow(HEADERS);
      headerRow.height = 32;
      headerRow.eachCell(cell => {
        cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border    = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
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
        const color = STATUS_COLOR[row.status];
        if (color) {
          r.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
            if (row.status === 'ARTIQ ÖDƏNİŞ') cell.font = { italic: true, bold: true, size: 10 };
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
