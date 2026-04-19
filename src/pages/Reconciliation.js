import React, { useState } from 'react';

export default function Reconciliation({ api }) {
  const [loading, setLoading] = useState(false);

  const exportExcel = async (scope) => {
    setLoading(true);
    try {
      const res = await fetch(`${api}/api/reconciliation?format=xlsx&scope=${scope}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `uzlasma_${scope}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
    } catch (e) { console.error(e); alert('Export xətası: ' + e.message); }
    setLoading(false);
  };

  return (
    <div>
      <div className="module-header">
        <div className="module-title"><span>03</span> — Rekonsiliasiya · Allokasiya</div>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={() => exportExcel('changed')} disabled={loading}>
            {loading ? 'Hazırlanır...' : '⬇ Yalnız Dəyişənlər'}
          </button>
          <button className="btn btn-primary" onClick={() => exportExcel('all')} disabled={loading}>
            {loading ? 'Hazırlanır...' : '⬇ Hamısını Export Et'}
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
