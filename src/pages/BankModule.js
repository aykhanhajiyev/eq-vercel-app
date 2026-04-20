import React, { useState, useEffect, useRef } from 'react';

const FIELDS = [
  { key: 'bankHesab', label: 'Bank / Hesab', type: 'text' },
  { key: 'tarix', label: 'Tarix', type: 'text', placeholder: 'dd.mm.yyyy' },
  { key: 'odeyiciVesait', label: 'Ödəyici / Vəsaiti Alan', type: 'text' },
  { key: 'medaxil', label: 'Mədaxil', type: 'number' },
  { key: 'mexaric', label: 'Məxaric', type: 'number' },
  { key: 'muracietNomresiEqfNomresi', label: 'Müraciət № (Məd) / EQF № (Məx)', type: 'text' },
  { key: 'hesabatUzreTeyinat', label: 'Hesabat Üzrə Təyinat', type: 'text', full: true },
  { key: 'voen', label: 'VÖEN', type: 'text' },
  { key: 'qeyd', label: 'Qeyd', type: 'textarea', full: true },
];

const empty = () => Object.fromEntries(FIELDS.map(f => [f.key, '']));
const fmt = n => Number(n || 0).toLocaleString('az-AZ', { minimumFractionDigits: 2 });
const parseNum = v => {
  if (typeof v === 'number') return v;
  let s = String(v || '').replace(/[\s\u00a0]/g, '');
  if (!s) return 0;
  // 41.975 və ya 1.234.567 — nöqtə minlik ayırıcıdır
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  return parseFloat(s) || 0;
};
const parseDate = v => {
  if (!v && v !== 0) return '';
  const fmt = (d, m, y) => `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}.${y}`;
  if (v instanceof Date) return fmt(v.getUTCDate(), v.getUTCMonth()+1, v.getUTCFullYear());
  const n = Number(v);
  if (!isNaN(n) && n > 30000 && n < 80000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    return fmt(d.getUTCDate(), d.getUTCMonth()+1, d.getUTCFullYear());
  }
  const match = String(v).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) return fmt(match[1], match[2], match[3]);
  return String(v);
};

export default function BankModule({ api, onUpdate }) {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());
  const [toast, setToast] = useState(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  const showToast = (msg, err = false) => {
    setToast({ msg, err }); setTimeout(() => setToast(null), 3000);
  };

  const load = async (p = page, s = search) => {
    try {
      const r = await fetch(`${api}/api/bank?page=${p}&limit=50&search=${encodeURIComponent(s)}`);
      const d = await r.json();
      setData(d.data); setTotal(d.total); setPages(d.pages);
    } catch { showToast('Yüklənmə xətası', true); }
  };

  useEffect(() => { load(1, search); }, [search]);

  const openAdd = () => { setEditing(null); setForm(empty()); setModal(true); };
  const openEdit = row => { setEditing(row._id); setForm({ ...row }); setModal(true); };

  const save = async () => {
    try {
      const url = editing ? `${api}/api/bank/${editing}` : `${api}/api/bank`;
      const method = editing ? 'PUT' : 'POST';
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setModal(false); load(page, search); onUpdate();
      showToast(editing ? 'Yeniləndi' : 'Əlavə edildi');
    } catch { showToast('Xəta', true); }
  };

  const del = async id => {
    if (!window.confirm('Silinsin?')) return;
    await fetch(`${api}/api/bank/${id}`, { method: 'DELETE' });
    load(page, search); onUpdate(); showToast('Silindi');
  };

  const handleFile = async file => {
    if (!file) return;
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, cellDates: true });
      const rows = rawRows.map(row =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), typeof v === 'string' ? v.trim() : v]))
      );
      const docs = rows.map(row => ({
        bankHesab: String(row['Bank / hesab'] || row['Bank/Hesab'] || ''),
        tarix: parseDate(row['Tarix'] ?? row['tarix']),
        odeyiciVesait: String(row['Ödəyici / Vəsaiti alan'] || row['Ödəyici/Vasitə'] || ''),
        medaxil: parseNum(row['Mədaxil'] ?? row['MəDaxil']),
        mexaric: parseNum(row['Məxaric']),
        qeyd: String(row['Qeyd'] || row['qeyd'] || ''),
        muracietNomresiEqfNomresi: String(
          row['Müraciət nömrəsi'] ||
          row['Müraciət nömrəsi (mədaxil)/ EQF nömrəsi (məxaric)'] ||
          row['Müraciət nömrəsi (mədaxil)/EQF nömrəsi (məxaric)'] ||
          Object.entries(row).find(([k]) => k.toLowerCase().includes('müraciət') || k.toLowerCase().includes('muraciət') || k.toLowerCase().includes('eqf'))?.[1] ||
          row['Müraciət №'] || ''
        ),
        hesabatUzreTeyinat: String(
          row['HESABAT ÜZRƏ TƏYİNAT'] ||
          row['Hesabat üzrə Təyinat'] ||
          Object.entries(row).find(([k]) => k.toLowerCase().includes('hesabat'))?.[1] ||
          ''
        ),
        voen: String(row['VÖEN'] || row['VOEN'] || row['voen'] || ''),
      }));
      const CHUNK = 500;
      let imported = 0;
      let failed = 0;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const r = await fetch(`${api}/api/bank/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(docs.slice(i, i + CHUNK)),
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(`Import HTTP ${r.status}: ${txt}`);
        }
        const d = await r.json();
        imported += d.imported || 0;
        failed += d.failed || 0;
      }
      setImportModal(false); load(1, ''); onUpdate();
      showToast(`Excel: ${docs.length} | Import: ${imported} | Uğursuz: ${failed}`);
    } catch (e) { showToast(`Import xətası: ${e.message}`, true); }
    setLoading(false);
  };

  const exportXlsx = () => window.open(`${api}/api/bank/export`, '_blank');

  return (
    <div>
      <div className="module-header">
        <div className="module-title"><span>02</span> — Bank / Hesab Əməliyyatları</div>
        <div className="toolbar">
          <input className="search-input" placeholder="Axtar: VOEN, Bank, Ödəyici..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <button className="btn btn-secondary" onClick={() => setImportModal(true)}>⬆ Import</button>
          <button className="btn btn-secondary" onClick={exportXlsx}>⬇ Export</button>
          <button className="btn btn-primary" onClick={openAdd}>+ Əlavə Et</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Bank / Hesab</th><th>Tarix</th><th>Ödəyici / Vəsaiti Alan</th>
              <th>Mədaxil</th><th>Məxaric</th><th>Müraciət № / EQF №</th>
              <th>Hesabat Üzrə Təyinat</th><th>VÖEN</th><th>Qeyd</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr><td colSpan={11}>
                <div className="empty-state"><div className="es-icon">🏦</div>Qeyd tapılmadı</div>
              </td></tr>
            )}
            {data.map((row, i) => (
              <tr key={row._id}>
                <td className="num" style={{ color: 'var(--text3)' }}>{(page - 1) * 50 + i + 1}</td>
                <td style={{ fontWeight: 600 }}>{row.bankHesab}</td>
                <td>{row.tarix}</td>
                <td>{row.odeyiciVesait}</td>
                <td className="num num-pos">{row.medaxil > 0 ? fmt(row.medaxil) : '—'}</td>
                <td className="num num-neg">{row.mexaric > 0 ? fmt(row.mexaric) : '—'}</td>
                <td style={{ fontSize: 11 }}>{row.muracietNomresiEqfNomresi}</td>
                <td>{row.hesabatUzreTeyinat}</td>
                <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{row.voen}</td>
                <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.qeyd}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(row)}>✏</button>
                    <button className="btn btn-danger btn-sm" onClick={() => del(row._id)}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span>Cəmi: {total} qeyd</span>
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1, search); }}>← Əvvəl</button>
        <span>{page} / {pages}</span>
        <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => { setPage(p => p + 1); load(page + 1, search); }}>Sonra →</button>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Redaktə Et' : 'Yeni Bank Qeydi'}</span>
              <button className="modal-close" onClick={() => setModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                {FIELDS.map(f => (
                  <div className={`form-group ${f.full ? 'full' : ''}`} key={f.key}>
                    <label className="form-label">{f.label}</label>
                    {f.type === 'textarea'
                      ? <textarea value={form[f.key] || ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} rows={3} />
                      : <input type={f.type} placeholder={f.placeholder || ''} value={form[f.key] || ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                    }
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Ləğv Et</button>
              <button className="btn btn-primary" onClick={save}>Yadda Saxla</button>
            </div>
          </div>
        </div>
      )}

      {importModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setImportModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Excel Import — Bank/Hesab</span>
              <button className="modal-close" onClick={() => setImportModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className={`import-zone ${drag ? 'drag' : ''}`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current.click()}>
                <div className="iz-title">📊 Excel faylı buraya sürükləyin</div>
                <p>və ya klikləyin seçin · .xlsx, .xls</p>
                {loading && <p style={{ color: 'var(--accent)', marginTop: 8 }}>Yüklənir...</p>}
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              <div style={{ marginTop: 16, background: 'var(--bg3)', padding: '12px 16px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', lineHeight: 2 }}>
                <div style={{ color: 'var(--accent)', marginBottom: 4, fontSize: 10, letterSpacing: 1 }}>EXCEL HEADER ADLARI:</div>
                Bank/Hesab · Tarix · Ödəyici/Vasitə · MəDaxil · Məxaric · Qeyd<br />
                Müraciət №(MəD) / EQF №(Məx) · Hesabat üzrə Təyinat · VOEN
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
