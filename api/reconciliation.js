const connectDB = require('./_db');
const { ElektronQaime, BankHesab } = require('./_models');
const XLSX = require('xlsx');

const EPS = 0.01;
const PRINCIPAL_TYPE = 'Yayım haqqı yığımı';
const VAT_TYPE = 'Digər daxilolmalar (ƏDV)';

const STATUS = {
  UNPAID: 'ÖDƏNİLMƏYİB',
  PARTIAL: 'QİSMƏN ÖDƏNİLİB',
  PAID: 'TAM ÖDƏNİLİB',
  OVERPAYMENT: 'ARTIQ ÖDƏNİŞ',
};

function safeNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function trunc2(n) {
  const x = safeNum(n);
  const sign = x < 0 ? -1 : 1;
  return sign * (Math.trunc(Math.abs(x) * 100) / 100);
}

function fmt2(n) {
  return trunc2(n).toFixed(2);
}

function normDate(v) {
  if (v == null || v === '') return '';
  const asNum = safeNum(v);
  if (asNum > 0 && String(v).trim().match(/^\d+(\.\d+)?$/)) {
    const ms = Math.round((asNum - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2.toISOString().slice(0, 10);
  return '';
}

function displayDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;

  const asNum = safeNum(v);
  if (asNum > 0 && s.match(/^\d+(\.\d+)?$/)) {
    const ms = Math.round((asNum - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${dd}.${mm}.${d.getUTCFullYear()}`;
    }
  }

  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) {
    const dd = String(d2.getUTCDate()).padStart(2, '0');
    const mm = String(d2.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d2.getUTCFullYear()}`;
  }

  return s;
}

function cmpDate(a, b) {
  return normDate(a).localeCompare(normDate(b));
}

function hasDate(v) {
  return normDate(v) !== '';
}

function buildStatus(principalOwed, vatOwed, principalPaid, vatPaid) {
  const rem = principalOwed + vatOwed;
  const paid = principalPaid + vatPaid;
  if (rem < EPS) return STATUS.PAID;
  if (paid > EPS) return STATUS.PARTIAL;
  return STATUS.UNPAID;
}

function allocateFifo(items, bankTxs, owedKey, paidKey, dateKey) {
  let i = 0;
  for (const tx of bankTxs) {
    while (tx.remaining > EPS && i < items.length) {
      const it = items[i];
      if (it[owedKey] < EPS) {
        i++;
        continue;
      }
      const take = Math.min(tx.remaining, it[owedKey]);
      it[paidKey] = trunc2(it[paidKey] + take);
      it[owedKey] = trunc2(it[owedKey] - take);
      tx.remaining = trunc2(tx.remaining - take);
      it[dateKey] = tx.tarix;
      if (it[owedKey] < EPS) {
        it[owedKey] = 0;
        i++;
      }
    }
    if (i >= items.length) break;
  }
}

function toBaseRow(eq) {
  const eqEsas = trunc2(eq.eqMeblegEsas);
  const eqEdv = trunc2(eq.eqMeblegEdv);
  const odEsas = trunc2(eq.odenisMeblegEsas);
  const odEdv = trunc2(eq.odenisMeblegEdv);

  const principalOwed = Math.max(0, trunc2(eqEsas - odEsas));
  const vatOwed = Math.max(0, trunc2(eqEdv - odEdv));

  return {
    reklamYayicisi: eq.reklamYayicisi || '',
    voen: eq.voen || '',
    icazeNo: (eq.icazeNo || '').trim(),
    eqTarixi: displayDate(eq.eqTarixi),
    eqNomresi: eq.eqNomresi || '',
    eqMeblegEsas: eqEsas,
    eqMeblegEdv: eqEdv,
    odenisTarixi: displayDate(eq.odenisTarixi),
    odenisMeblegEsas: odEsas,
    odenisTarixiEdv: displayDate(eq.odenisTarixiEdv),
    odenisMeblegEdv: odEdv,
    qeyd: eq.qeyd || '',
    _principalOwed: principalOwed,
    _vatOwed: vatOwed,
    status: buildStatus(principalOwed, vatOwed, odEsas, odEdv),
  };
}

function buildRows(eqData, bankData) {
  const groups = new Map();

  for (const eq of eqData) {
    const key = (eq.icazeNo || '').trim() || `__no_icaze__${eq._id}`;
    if (!groups.has(key)) {
      groups.set(key, { eqs: [], principalTx: [], vatTx: [] });
    }
    groups.get(key).eqs.push(eq);
  }

  for (const b of bankData) {
    const medaxil = safeNum(b.medaxil);
    if (!(medaxil > EPS)) continue;
    const ref = (b.muracietNomresiEqfNomresi || '').trim();
    if (!ref || !groups.has(ref)) continue;
    const t = (b.hesabatUzreTeyinat || '').trim();
    const tx = { tarix: b.tarix, remaining: trunc2(medaxil), qeyd: b.qeyd || '' };
    if (t === PRINCIPAL_TYPE) groups.get(ref).principalTx.push(tx);
    if (t === VAT_TYPE) groups.get(ref).vatTx.push(tx);
  }

  const keys = Array.from(groups.keys());
  const rows = [];

  for (const key of keys) {
    const g = groups.get(key);
    const originalEqs = g.eqs.slice();
    const sortedEqs = originalEqs.slice().sort((a, b) => cmpDate(a.eqTarixi, b.eqTarixi));

    const frozenRowsById = new Map();
    const updatable = [];

    for (const eq of sortedEqs) {
      if (hasDate(eq.odenisTarixi)) {
        frozenRowsById.set(String(eq._id), toBaseRow(eq));
      } else {
        updatable.push(eq);
      }
    }

    const work = updatable.map(eq => {
      const base = toBaseRow(eq);
      return {
        ...base,
        _principalPaid: base.odenisMeblegEsas,
        _vatPaid: base.odenisMeblegEdv,
        _principalDateRaw: eq.odenisTarixi || '',
        _vatDateRaw: eq.odenisTarixiEdv || '',
      };
    });

    const pTx = g.principalTx.slice().sort((a, b) => cmpDate(a.tarix, b.tarix));
    const vTx = g.vatTx.slice().sort((a, b) => cmpDate(a.tarix, b.tarix));

    allocateFifo(work, pTx, '_principalOwed', '_principalPaid', '_principalDateRaw');
    allocateFifo(work, vTx, '_vatOwed', '_vatPaid', '_vatDateRaw');

    const updatedRowsById = new Map();
    for (let i = 0; i < work.length; i++) {
      const w = work[i];
      const eq = updatable[i];
      updatedRowsById.set(String(eq._id), {
        reklamYayicisi: w.reklamYayicisi,
        voen: w.voen,
        icazeNo: w.icazeNo,
        eqTarixi: w.eqTarixi,
        eqNomresi: w.eqNomresi,
        eqMeblegEsas: trunc2(w.eqMeblegEsas),
        eqMeblegEdv: trunc2(w.eqMeblegEdv),
        odenisTarixi: displayDate(w._principalDateRaw),
        odenisMeblegEsas: trunc2(w._principalPaid),
        odenisTarixiEdv: displayDate(w._vatDateRaw),
        odenisMeblegEdv: trunc2(w._vatPaid),
        qeyd: w.qeyd,
        status: buildStatus(w._principalOwed, w._vatOwed, w._principalPaid, w._vatPaid),
      });
    }

    const merged = [];
    for (const eq of originalEqs) {
      const id = String(eq._id);
      if (hasDate(eq.odenisTarixi)) {
        if (frozenRowsById.has(id)) merged.push(frozenRowsById.get(id));
      } else if (updatedRowsById.has(id)) {
        merged.push(updatedRowsById.get(id));
      }
    }
    rows.push(...merged);

    const pLeft = pTx.filter(x => x.remaining > EPS);
    const vLeft = vTx.filter(x => x.remaining > EPS);

    const principalOver = trunc2(pLeft.reduce((s, x) => s + x.remaining, 0));
    const vatOver = trunc2(vLeft.reduce((s, x) => s + x.remaining, 0));

    if (principalOver > EPS || vatOver > EPS) {
      const lastP = pLeft.length ? pLeft[pLeft.length - 1] : null;
      const lastV = vLeft.length ? vLeft[vLeft.length - 1] : null;

      const noteList = []
        .concat(pLeft.map(x => (x.qeyd || '').trim()))
        .concat(vLeft.map(x => (x.qeyd || '').trim()))
        .filter(Boolean);
      const uniqNote = Array.from(new Set(noteList)).join('; ');

      rows.push({
        reklamYayicisi: '',
        voen: '',
        icazeNo: key,
        eqTarixi: '',
        eqNomresi: '',
        eqMeblegEsas: 0,
        eqMeblegEdv: 0,
        odenisTarixi: displayDate(lastP ? lastP.tarix : ''),
        odenisMeblegEsas: principalOver,
        odenisTarixiEdv: displayDate(lastV ? lastV.tarix : ''),
        odenisMeblegEdv: vatOver,
        qeyd: uniqNote,
        status: STATUS.OVERPAYMENT,
      });
    }
  }

  return rows;
}

function buildExcel(rows) {
  const wb = XLSX.utils.book_new();
  const sheetRows = rows.map(r => ({
    'Reklam yayıcısının adı': r.reklamYayicisi,
    'VÖEN': r.voen,
    'İcazə': r.icazeNo,
    'Elektron qaimənin tarixi': r.eqTarixi,
    'Elektron qaimənin nömrəsi': r.eqNomresi,
    'EQ məbləği(əsas)': fmt2(r.eqMeblegEsas),
    'EQ məbləği(ƏDV)': fmt2(r.eqMeblegEdv),
    'Ödəniş tarixi': r.odenisTarixi,
    'Ödəniş məbləği(Əsas)': fmt2(r.odenisMeblegEsas),
    'Ödəniş tarixi(ƏDV)': r.odenisTarixiEdv,
    'Ödəniş məbləği(ƏDV)': fmt2(r.odenisMeblegEdv),
    'Qeyd': r.qeyd,
    'Status': r.status,
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Uzlaşma');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  await connectDB();

  const [eqData, bankData] = await Promise.all([
    ElektronQaime.find({}).sort({ createdAt: 1, _id: 1 }).lean(),
    BankHesab.find({}).lean(),
  ]);

  const rows = buildRows(eqData, bankData);

  if (req.query && req.query.format === 'xlsx') {
    const buf = buildExcel(rows);
    res.setHeader('Content-Disposition', 'attachment; filename=uzlasma.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }

  return res.json({ rows });
};
