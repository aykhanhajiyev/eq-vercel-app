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

const safeNum = v => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.').trim());
    return isFinite(n) ? n : 0;
  }
  return 0;
};

// Normalize any incoming date (dd.mm.yyyy string, ISO string, or Excel serial number)
// into YYYY-MM-DD for lexicographic comparison. Returns '' if unparsable.
function normDate(v) {
  if (v == null || v === '') return '';
  const asNum = safeNum(v);
  if (asNum > 0) {
    const ms = Math.round((asNum - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2.toISOString().slice(0, 10);
  return '';
}

// Display a date in dd.mm.yyyy. Passes through strings already in that form.
function displayDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
  const asNum = safeNum(v);
  if (asNum > 0) {
    const ms = Math.round((asNum - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()}`;
  }
  return s;
}

const cmpDate = (a, b) => normDate(a).localeCompare(normDate(b));
const hasDate = v => normDate(v) !== '';

// FIFO allocation: drains bankTxs into items. owedKey decrements, paidKey
// accumulates, dateKey is set only when the component is fully paid.
function fifoAllocate(items, bankTxs, owedKey, paidKey, dateKey) {
  let idx = 0;
  for (const tx of bankTxs) {
    while (tx.remaining > EPS && idx < items.length) {
      const item = items[idx];
      if (item[owedKey] < EPS) { idx++; continue; }
      const take = Math.min(tx.remaining, item[owedKey]);
      item[paidKey] += take;
      item[owedKey] -= take;
      tx.remaining -= take;
      item[dateKey] = tx.tarix;
      if (item[owedKey] < EPS) {
        item[owedKey] = 0;
        idx++;
      }
    }
    if (idx >= items.length) break;
  }
}

function buildRows(eqData, bankData) {
  const groups = {};
  eqData.forEach(eq => {
    const key = (eq.icazeNo || '').trim() || `__no_icaze__${eq._id}`;
    if (!groups[key]) {
      groups[key] = {
        icazeNo: (eq.icazeNo || '').trim(),
        voen: eq.voen || '',
        reklamYayicisi: eq.reklamYayicisi || '',
        eqs: [],
        principalBanks: [],
        vatBanks: [],
      };
    }
    groups[key].eqs.push(eq);
  });

  // STRICT: only icazeNo === muracietNomresiEqfNomresi. No fallback keys.
  bankData.forEach(b => {
    if (!(safeNum(b.medaxil) > EPS)) return;
    const ref = (b.muracietNomresiEqfNomresi || '').trim();
    if (!ref || !groups[ref]) return;
    const type = (b.hesabatUzreTeyinat || '').trim();
    if (type === PRINCIPAL_TYPE) groups[ref].principalBanks.push(b);
    else if (type === VAT_TYPE) groups[ref].vatBanks.push(b);
  });

  // Deterministic group order
  const groupKeys = Object.keys(groups).sort();

  const rows = [];

  groupKeys.forEach(gk => {
    const { icazeNo, voen, reklamYayicisi, eqs, principalBanks, vatBanks } = groups[gk];

    const unpaid = eqs
      .filter(eq => !hasDate(eq.odenisTarixi))
      .sort((a, b) => cmpDate(a.eqTarixi, b.eqTarixi));

    if (unpaid.length === 0) return;

    const items = unpaid.map(eq => {
      const principalOrig = safeNum(eq.eqMeblegEsas);
      const vatOrig = safeNum(eq.eqMeblegEdv);
      return {
        reklamYayicisi: eq.reklamYayicisi || '',
        voen: eq.voen || '',
        icazeNo: (eq.icazeNo || '').trim(),
        eqTarixi: displayDate(eq.eqTarixi),
        eqNomresi: eq.eqNomresi || '',
        eqMeblegEsas: principalOrig,
        eqMeblegEdv: vatOrig,
        qeyd: eq.qeyd || '',
        principalOwed: principalOrig,
        principalPaid: 0,
        principalDate: '',
        vatOwed: vatOrig,
        vatPaid: 0,
        vatDate: '',
      };
    });

    const pBanks = principalBanks
      .slice()
      .sort((a, b) => cmpDate(a.tarix, b.tarix))
      .map(b => ({ tarix: b.tarix, remaining: safeNum(b.medaxil), qeyd: b.qeyd || '' }));

    const vBanks = vatBanks
      .slice()
      .sort((a, b) => cmpDate(a.tarix, b.tarix))
      .map(b => ({ tarix: b.tarix, remaining: safeNum(b.medaxil), qeyd: b.qeyd || '' }));

    // Principal and VAT flows are fully independent — no cross-allocation.
    fifoAllocate(items, pBanks, 'principalOwed', 'principalPaid', 'principalDate');
    fifoAllocate(items, vBanks, 'vatOwed', 'vatPaid', 'vatDate');

    items.forEach(item => {
      const remaining = item.principalOwed + item.vatOwed;
      const paid = item.principalPaid + item.vatPaid;
      const status =
        remaining < EPS ? STATUS.PAID :
        paid > EPS ? STATUS.PARTIAL :
        STATUS.UNPAID;

      rows.push({
        reklamYayicisi: item.reklamYayicisi,
        voen: item.voen,
        icazeNo: item.icazeNo,
        eqTarixi: item.eqTarixi,
        eqNomresi: item.eqNomresi,
        eqMeblegEsas: item.eqMeblegEsas,
        eqMeblegEdv: item.eqMeblegEdv,
        odenisTarixi: displayDate(item.principalDate),
        odenisMeblegEsas: item.principalPaid,
        odenisTarixiEdv: displayDate(item.vatDate),
        odenisMeblegEdv: item.vatPaid,
        qeyd: item.qeyd,
        status,
      });
    });

    // Bank leftovers → single ARTIQ ÖDƏNİŞ row per group (both principal + VAT in same row).
    const principalLeft = pBanks
      .filter(tx => tx.remaining > EPS)
      .sort((a, b) => cmpDate(a.tarix, b.tarix));
    const vatLeft = vBanks
      .filter(tx => tx.remaining > EPS)
      .sort((a, b) => cmpDate(a.tarix, b.tarix));

    const principalOverpay = principalLeft.reduce((s, tx) => s + tx.remaining, 0);
    const vatOverpay = vatLeft.reduce((s, tx) => s + tx.remaining, 0);

    if (principalOverpay > EPS || vatOverpay > EPS) {
      const qeyds = []
        .concat(principalLeft.map(tx => tx.qeyd || ''))
        .concat(vatLeft.map(tx => tx.qeyd || ''))
        .map(s => s.trim())
        .filter(Boolean);
      const uniqQeyd = Array.from(new Set(qeyds)).join('; ');

      rows.push({
        reklamYayicisi: '',
        voen: '',
        icazeNo: '',
        eqTarixi: '',
        eqNomresi: '',
        eqMeblegEsas: 0,
        eqMeblegEdv: 0,
        odenisTarixi: displayDate(principalLeft.length ? principalLeft[principalLeft.length - 1].tarix : ''),
        odenisMeblegEsas: principalOverpay > EPS ? principalOverpay : 0,
        odenisTarixiEdv: displayDate(vatLeft.length ? vatLeft[vatLeft.length - 1].tarix : ''),
        odenisMeblegEdv: vatOverpay > EPS ? vatOverpay : 0,
        qeyd: uniqQeyd,
        status: STATUS.OVERPAYMENT,
      });
    }
  });

  return rows;
}

function buildExcel(rows) {
  const wb = XLSX.utils.book_new();
  const sheet = rows.map(r => ({
    'Reklam yayıcısının adı': r.reklamYayicisi,
    'VÖEN': r.voen,
    'İcazə': r.icazeNo,
    'Elektron qaimənin tarixi': r.eqTarixi,
    'Elektron qaimənin nömrəsi': r.eqNomresi,
    'EQ məbləği(əsas)': r.eqMeblegEsas,
    'EQ məbləği(ƏDV)': r.eqMeblegEdv,
    'Ödəniş tarixi': r.odenisTarixi,
    'Ödəniş məbləği(Əsas)': r.odenisMeblegEsas,
    'Ödəniş tarixi(ƏDV)': r.odenisTarixiEdv,
    'Ödəniş məbləği(ƏDV)': r.odenisMeblegEdv,
    'Qeyd': r.qeyd,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Uzlaşma');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  await connectDB();

  const [eqData, bankData] = await Promise.all([
    ElektronQaime.find({}).lean(),
    BankHesab.find({}).lean(),
  ]);

  const rows = buildRows(eqData, bankData);

  if (req.query && req.query.format === 'xlsx') {
    const buf = buildExcel(rows);
    res.setHeader('Content-Disposition', 'attachment; filename=uzlasma.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }

  res.json({ rows });
};
