const connectDB = require('./_db');
const { ElektronQaime, BankHesab } = require('./_models');
const XLSX = require('xlsx');

const EPS = 0.01;
const PRINCIPAL_TYPE = 'Yayım haqqı yığımı';
const VAT_TYPE = 'Digər daxilolmalar (ƏDV)';

const STATUS_AZ = {
  UNPAID: 'ÖDƏNİLMƏYİB',
  PARTIAL: 'QİSMƏN ÖDƏNİLİB',
  PAID: 'TAM ÖDƏNİLİB',
  OVERPAYMENT: 'ARTIQ ÖDƏNİŞ',
};

const safeNum = v => (typeof v === 'number' && isFinite(v) ? v : 0);

const sortKey = s => {
  const m = String(s || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const cmpDate = (a, b) => sortKey(a).localeCompare(sortKey(b));
const hasDate = s => !!String(s || '').trim();

// FIFO allocation: drains bankTxs into items independently per component.
// owedKey decrements, paidKey accumulates, dateKey is set only on full pay.
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
      if (item[owedKey] < EPS) {
        item[owedKey] = 0;
        item[dateKey] = tx.tarix;
        idx++;
      }
    }
    if (idx >= items.length) break;
  }
}

function buildReconciliation(eqData, bankData) {
  // Group invoices by icazeNo
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

  // Route bank entries: match ONLY by icazeNo === muracietNomresiEqfNomresi
  bankData.forEach(b => {
    if (!(safeNum(b.medaxil) > EPS)) return;
    const ref = (b.muracietNomresiEqfNomresi || '').trim();
    if (!ref || !groups[ref]) return;
    const type = (b.hesabatUzreTeyinat || '').trim();
    if (type === PRINCIPAL_TYPE) groups[ref].principalBanks.push(b);
    else if (type === VAT_TYPE) groups[ref].vatBanks.push(b);
  });

  const rows = [];
  const summary = [];

  Object.values(groups).forEach(({ icazeNo, voen, reklamYayicisi, eqs, principalBanks, vatBanks }) => {
    // Only invoices where principal date is not yet set
    const unpaid = eqs
      .filter(eq => !hasDate(eq.odenisTarixi))
      .sort((a, b) => cmpDate(a.eqTarixi, b.eqTarixi));

    if (unpaid.length === 0) return;

    const items = unpaid.map(eq => {
      const principalOrig = safeNum(eq.eqMeblegEsas);
      const vatOrig = safeNum(eq.eqMeblegEdv);
      return {
        invoiceId: String(eq._id),
        icazeNo: (eq.icazeNo || '').trim(),
        eqNomresi: eq.eqNomresi || '',
        eqTarixi: eq.eqTarixi || '',
        voen: eq.voen || '',
        reklamYayicisi: eq.reklamYayicisi || '',
        qeyd: eq.qeyd || '',
        eqMeblegEsas: principalOrig,
        eqMeblegEdv: vatOrig,
        principalOrig,
        vatOrig,
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
      .map(b => ({ tarix: b.tarix || '', remaining: safeNum(b.medaxil) }));

    const vBanks = vatBanks
      .slice()
      .sort((a, b) => cmpDate(a.tarix, b.tarix))
      .map(b => ({ tarix: b.tarix || '', remaining: safeNum(b.medaxil) }));

    // Independent FIFO flows — principal and VAT never cross
    fifoAllocate(items, pBanks, 'principalOwed', 'principalPaid', 'principalDate');
    fifoAllocate(items, vBanks, 'vatOwed', 'vatPaid', 'vatDate');

    items.forEach(item => {
      const originalAmount = item.principalOrig + item.vatOrig;
      const paidAmount = item.principalPaid + item.vatPaid;
      const remainingAmount = item.principalOwed + item.vatOwed;
      const status = remainingAmount < EPS ? 'PAID' : paidAmount > EPS ? 'PARTIAL' : 'UNPAID';
      const paymentDate = [item.principalDate, item.vatDate]
        .filter(hasDate)
        .sort(cmpDate)
        .pop() || '';

      rows.push({
        invoiceId: item.invoiceId,
        icazeNo: item.icazeNo,
        eqNomresi: item.eqNomresi,
        eqTarixi: item.eqTarixi,
        voen: item.voen,
        reklamYayicisi: item.reklamYayicisi,
        qeyd: item.qeyd,
        eqMeblegEsas: item.eqMeblegEsas,
        eqMeblegEdv: item.eqMeblegEdv,
        originalAmount,
        paidAmount,
        remainingAmount,
        odenisTarixi: item.principalDate,
        odenisMeblegEsas: item.principalPaid,
        odenisTarixiEdv: item.vatDate,
        odenisMeblegEdv: item.vatPaid,
        status,
        paymentDate,
      });
    });

    const princOverpay = pBanks.reduce((s, tx) => s + Math.max(0, tx.remaining), 0);
    const vatOverpay = vBanks.reduce((s, tx) => s + Math.max(0, tx.remaining), 0);

    if (princOverpay > EPS) {
      const overpayDate = pBanks
        .filter(tx => tx.remaining > EPS)
        .map(tx => tx.tarix)
        .sort(cmpDate)
        .pop() || '';
      rows.push({
        invoiceId: '',
        icazeNo,
        eqNomresi: '',
        eqTarixi: '',
        voen,
        reklamYayicisi,
        qeyd: '',
        eqMeblegEsas: 0,
        eqMeblegEdv: 0,
        originalAmount: 0,
        paidAmount: 0,
        remainingAmount: princOverpay,
        odenisTarixi: '',
        odenisMeblegEsas: princOverpay,
        odenisTarixiEdv: '',
        odenisMeblegEdv: 0,
        status: 'OVERPAYMENT',
        paymentDate: overpayDate,
      });
    }

    if (vatOverpay > EPS) {
      const overpayDate = vBanks
        .filter(tx => tx.remaining > EPS)
        .map(tx => tx.tarix)
        .sort(cmpDate)
        .pop() || '';
      rows.push({
        invoiceId: '',
        icazeNo,
        eqNomresi: '',
        eqTarixi: '',
        voen,
        reklamYayicisi,
        qeyd: '',
        eqMeblegEsas: 0,
        eqMeblegEdv: 0,
        originalAmount: 0,
        paidAmount: 0,
        remainingAmount: vatOverpay,
        odenisTarixi: '',
        odenisMeblegEsas: 0,
        odenisTarixiEdv: '',
        odenisMeblegEdv: vatOverpay,
        status: 'OVERPAYMENT',
        paymentDate: overpayDate,
      });
    }

    const totalInvoiceAmount = items.reduce((s, i) => s + i.principalOrig + i.vatOrig, 0);
    const totalPaid = items.reduce((s, i) => s + i.principalPaid + i.vatPaid, 0);
    const remainingBalance = items.reduce((s, i) => s + i.principalOwed + i.vatOwed, 0);
    const overpayment = princOverpay + vatOverpay;

    summary.push({
      icazeNo,
      voen,
      reklamYayicisi,
      totalInvoiceAmount,
      totalPaid,
      remainingBalance,
      overpayment: overpayment > EPS ? overpayment : 0,
    });
  });

  return { rows, summary };
}

function buildExcel(rows, summary) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Uzlaşma — exact 12 Azerbaijani headers + Status
  const uzlasmaRows = rows.map(r => ({
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
    'Status': STATUS_AZ[r.status] || r.status,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(uzlasmaRows), 'Uzlaşma');

  // Sheet 2: Xülasə — summary per icazeNo
  const xulaseRows = summary.map(s => ({
    'İcazə': s.icazeNo,
    'VÖEN': s.voen,
    'Reklam yayıcısının adı': s.reklamYayicisi,
    'Ümumi EQ məbləği': s.totalInvoiceAmount,
    'Ödənilmiş məbləğ': s.totalPaid,
    'Qalıq məbləğ': s.remainingBalance,
    'Artıq ödəniş': s.overpayment,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(xulaseRows), 'Xülasə');

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

  const { rows, summary } = buildReconciliation(eqData, bankData);

  if (req.query && req.query.format === 'xlsx') {
    const buf = buildExcel(rows, summary);
    res.setHeader('Content-Disposition', 'attachment; filename=uzlasma.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }

  res.json({ rows, summary });
};
