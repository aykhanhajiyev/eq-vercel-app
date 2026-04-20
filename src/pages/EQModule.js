import React, { useState, useEffect, useRef } from 'react';

const FIELDS = [
  { key: 'reklamYayicisi', label: 'Reklam Yayıcısının Adı', type: 'text', full: true },
  { key: 'voen', label: 'VÖEN', type: 'text' },
  { key: 'icazeNo', label: 'İcazə', type: 'text' },
  { key: 'eqTarixi', label: 'EQ Tarixi', type: 'text', placeholder: 'dd.mm.yyyy' },
  { key: 'eqNomresi', label: 'EQ Nömrəsi', type: 'text' },
  { key: 'eqMeblegEsas', label: 'EQ Məbləği (Əsas)', type: 'number' },
  { key: 'eqMeblegEdv', label: 'EQ Məbləği (ƏDV)', type: 'number' },
  { key: 'odenisTarixi', label: 'Ödəniş Tarixi', type: 'text', placeholder: 'dd.mm.yyyy' },
  { key: 'odenisMeblegEsas', label: 'Ödəniş Məbləği (Əsas)', type: 'number' },
  { key: 'odenisTarixiEdv', label: 'Ödəniş Tarixi (ƏDV)', type: 'text', placeholder: 'dd.mm.yyyy' },
  { key: 'odenisMeblegEdv', label: 'Ödəniş Məbləği (ƏDV)', type: 'number' },
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
const showDate = v => {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return parseDate(v);
  const s = String(v).trim();
  if (!s) return '';
  const d = new Date(s);
  if (!isNaN(d.getTime()) && !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) {
    return parseDate(d);
  }
  return parseDate(s);
};

export default function EQModule({ api, onUpdate }) {
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
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async (p = page, s = search) => {
    try {
      const r = await fetch(`${api}/api/eq?page=${p}&limit=50&search=${encodeURIComponent(s)}`);
      const d = await r.json();
      setData(d.data); setTotal(d.total); setPages(d.pages);
    } catch { showToast('Yüklənmə xətası', true); }
  };

  useEffect(() => { load(1, search); }, [search]);

  const openAdd = () => { setEditing(null); setForm(empty()); setModal(true); };
  const openEdit = (row) => { setEditing(row._id); setForm({ ...row }); setModal(true); };

  const save = async () => {
    try {
      const url = editing ? `${api}/api/eq/${editing}` : `${api}/api/eq`;
      const method = editing ? 'PUT' : 'POST';
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setModal(false); load(page, search); onUpdate();
      showToast(editing ? 'Yeniləndi' : 'Əlavə edildi');
    } catch { showToast('Xəta', true); }
  };

  const del = async (id) => {
    if (!window.confirm('Silinsin?')) return;
    await fetch(`${api}/api/eq/${id}`, { method: 'DELETE' });
    load(page, search); onUpdate(); showToast('Silindi');
  };

  const deleteAll = async () => {
    const password = window.prompt('Bütün elektron qaimələri silmək üçün şifrəni daxil edin:');
    if (password == null) return;
    if (!window.confirm('DİQQƏT: Bütün elektron qaimələr silinəcək. Davam edilsin?')) return;
    try {
      const r = await fetch(`${api}/api/eq`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return showToast(d.error || 'Xəta', true);
      load(1, ''); onUpdate(); showToast(`${d.deleted ?? 0} qeyd silindi`);
    } catch (e) { showToast(`Xəta: ${e.message}`, true); }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, cellDates: true });
      if (rawRows.length === 0) {
        showToast('Excel faylı boşdur və ya header sətri tapılmadı', true);
        setLoading(false);
        return;
      }
      const rows = rawRows.map(row =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), typeof v === 'string' ? v.trim() : v]))
      );
      const docs = rows.map(row => ({
        reklamYayicisi: String(row['Reklam yayıcısının adı'] || ''),
        voen: String(row['VÖEN'] || row['VOEN'] || row['voen'] || ''),
        icazeNo: String(row['İcazə'] || row['İcazə №'] || row['icazeNo'] || ''),
        eqTarixi: parseDate(row['Elektron qaimənin tarixi'] || row['EQ tarixi']),
        eqNomresi: String(row['Elektron qaimənin nömrəsi'] || row['EQ nömrəsi'] || ''),
        eqMeblegEsas: parseNum(row['EQ məbləği(əsas)'] ?? row['EQ məbləği (əsas)']),
        eqMeblegEdv: parseNum(row['EQ məbləği(ƏDV)'] ?? row['EQ məbləği (ƏDV)']),
        odenisTarixi: parseDate(row['Ödəniş tarixi']),
        odenisMeblegEsas: parseNum(row['Ödəniş məbləği(Əsas)'] ?? row['Ödəniş məbləği (Əsas)']),
        odenisTarixiEdv: parseDate(row['Ödəniş tarixi(ƏDV)'] ?? row['Ödəniş tarixi (ƏDV)']),
        odenisMeblegEdv: parseNum(row['Ödəniş məbləği(ƏDV)'] ?? row['Ödəniş məbləği (ƏDV)']),
        qeyd: String(row['Qeyd'] || row['qeyd'] || ''),
      }));
      if (docs.length === 0) {
        showToast('Heç bir uyğun sətir tapılmadı. Header adlarını yoxlayın.', true);
        setLoading(false);
        return;
      }
      const CHUNK = 500;
      let imported = 0;
      let failed = 0;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const r = await fetch(`${api}/api/eq/import`, {
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

  const exportXlsx = () => { window.open(`${api}/api/eq/export`, '_blank'); };

  return (
    <div>
      <div className="module-header">
        <div className="module-title"><span>01</span> — Elektron Qaime</div>
        <div className="toolbar">
          <input className="search-input" placeholder="Axtar: VOEN, İcazə №, Qeyd..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <button className="btn btn-secondary" onClick={() => setImportModal(true)}>⬆ Import</button>
          <button className="btn btn-secondary" onClick={exportXlsx}>⬇ Export</button>
          <button className="btn btn-danger" onClick={deleteAll}>🗑 Hamısını Sil</button>
          <button className="btn btn-primary" onClick={openAdd}>+ Əlavə Et</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Reklam Yayıcısı</th><th>VÖEN</th><th>İcazə</th>
              <th>EQ Tarixi</th><th>EQ Nömrəsi</th>
              <th>EQ Məbl.(Əsas)</th><th>EQ Məbl.(ƏDV)</th>
              <th>Öd. Tarixi</th><th>Öd. Məbl.(Əsas)</th>
              <th>Öd. Tarixi(ƏDV)</th><th>Öd. Məbl.(ƏDV)</th>
              <th>Qeyd</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr><td colSpan={14}>
                <div className="empty-state"><div className="es-icon">📄</div>Qeyd tapılmadı</div>
              </td></tr>
            )}
            {data.map((row, i) => (
              <tr key={row._id}>
                <td className="num" style={{ color: 'var(--text3)' }}>{(page - 1) * 50 + i + 1}</td>
                <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.reklamYayicisi}</td>
                <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{row.voen}</td>
                <td>{row.icazeNo}</td>
                <td>{row.eqTarixi}</td>
                <td>{row.eqNomresi}</td>
                <td className="num num-pos">{fmt(row.eqMeblegEsas)}</td>
                <td className="num num-pos">{fmt(row.eqMeblegEdv)}</td>
                <td>{showDate(row.odenisTarixi)}</td>
                <td className="num num-pos">{fmt(row.odenisMeblegEsas)}</td>
                <td>{showDate(row.odenisTarixiEdv)}</td>
                <td className="num num-pos">{fmt(row.odenisMeblegEdv)}</td>
                <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.qeyd}</td>
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

      {/* ADD/EDIT MODAL */}
      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Redaktə Et' : 'Yeni EQ'}</span>
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

      {/* IMPORT MODAL */}
      {importModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setImportModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Excel Import — EQ</span>
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
                VOEN · İcazə № · EQ tarixi · EQ məbləği (əsas) · EQ məbləği (ƏDV)<br />
                Ödəniş tarixi · Ödəniş tarixi (əsas) · Ödəniş tarixi (ƏDV) · Ödəniş məbləği (ƏDV) · Qeyd
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
