const connectDB = require('./_db');
const { ElektronQaime, BankHesab } = require('./_models');
const ExcelJS = require('exceljs');

const EPS = 0.01;
const PAID_TOLERANCE = 0.02;
const PRINCIPAL_TYPE = 'Yayım haqqı yığımı';
const VAT_TYPE = 'Digər daxilolmalar (ƏDV)';

const STATUS = {
  UNPAID: 'ÖDƏNİLMƏYİB',
  PARTIAL: 'QİSMƏN ÖDƏNİLİB',
  PAID: 'TAM ÖDƏNİLİB',
  PRINCIPAL_UNPAID: 'ƏSAS Məbləğ ödənilməyib',
  VAT_UNPAID: 'ƏDV ödənişi ödənilməyib',
  OVERPAYMENT: 'ARTIQ ÖDƏNİŞ',
  DEBT: 'BORC',
  NO_MATCH: 'UYĞUN EQ TAPILMADI',
};

const ROW_COLOR = {
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED',
};

const FILL = {
  GREEN: 'FFC6EFCE',
  YELLOW: 'FFFFF2CC',
  RED: 'FFF8CBAD',
  HEADER: 'FFE2EFDA',
};

function safeNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function round2(n) {
  const x = safeNum(n);
  return Math.round(x * 100) / 100;
}

function normDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();

  if (/^\d+(\.\d+)?$/.test(s)) {
    const asNum = safeNum(s);
    if (asNum > 0) {
      const ms = Math.round((asNum - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

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

  if (/^\d+(\.\d+)?$/.test(s)) {
    const asNum = safeNum(s);
    if (asNum > 0) {
      const ms = Math.round((asNum - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        return `${dd}.${mm}.${d.getUTCFullYear()}`;
      }
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
  const principalCleared = principalOwed < EPS;
  const vatCleared = vatOwed < EPS;

  if (principalCleared && vatCleared) return STATUS.PAID;
  if (principalCleared && !vatCleared) return STATUS.VAT_UNPAID;
  if (!principalCleared && vatPaid > EPS) return STATUS.PRINCIPAL_UNPAID;
  if (principalPaid < EPS && vatPaid < EPS) return STATUS.UNPAID;
  return STATUS.PARTIAL;
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
      it[paidKey] = round2(it[paidKey] + take);
      it[owedKey] = round2(it[owedKey] - take);
      tx.remaining = round2(tx.remaining - take);
      it[dateKey] = tx.tarix;
      if (it[owedKey] <= PAID_TOLERANCE) {
        it[owedKey] = 0;
        i++;
      }
    }
    if (i >= items.length) break;
  }
}

function toBaseRow(eq) {
  const eqEsas = round2(eq.eqMeblegEsas);
  const eqEdv = round2(eq.eqMeblegEdv);
  const odEsas = round2(eq.odenisMeblegEsas);
  const odEdv = round2(eq.odenisMeblegEdv);

  const principalOwed = Math.max(0, round2(eqEsas - odEsas));
  const vatOwed = Math.max(0, round2(eqEdv - odEdv));

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
    _rowColor: '',
    _changed: false,
  };
}

function groupEqs(eqData) {
  const groups = new Map();
  for (const eq of eqData) {
    const icaze = (eq.icazeNo || '').trim();
    const key = icaze === 'Avans'
      ? `__avans__${eq._id}`
      : (icaze || `__no_icaze__${eq._id}`);
    if (!groups.has(key)) {
      groups.set(key, { eqs: [], principalTx: [], vatTx: [] });
    }
    groups.get(key).eqs.push(eq);
  }
  return groups;
}

function distributeBank(bankData, groups) {
  const unmatchedBankRows = [];

  for (const b of bankData) {
    const ref = (b.muracietNomresiEqfNomresi || '').trim();
    if (!ref) continue;

    const medaxil = round2(safeNum(b.medaxil));

    if (!groups.has(ref)) {
      const tRaw = (b.hesabatUzreTeyinat || '').trim();
      const amount = medaxil > EPS ? medaxil : 0;
      unmatchedBankRows.push({
        reklamYayicisi: b.odeyiciVesait || '',
        voen: b.voen || '',
        icazeNo: ref,
        eqTarixi: '',
        eqNomresi: '',
        eqMeblegEsas: 0,
        eqMeblegEdv: 0,
        odenisTarixi: displayDate(b.tarix),
        odenisMeblegEsas: tRaw === VAT_TYPE ? 0 : amount,
        odenisTarixiEdv: displayDate(b.tarix),
        odenisMeblegEdv: tRaw === VAT_TYPE ? amount : 0,
        qeyd: b.qeyd || '',
        status: STATUS.NO_MATCH,
        _rowColor: ROW_COLOR.YELLOW,
        _changed: true,
        _matched: false,
      });
      continue;
    }

    if (!(medaxil > EPS)) continue;

    const t = (b.hesabatUzreTeyinat || '').trim();
    const tx = { tarix: b.tarix, remaining: round2(medaxil), qeyd: b.qeyd || '' };
    if (t === PRINCIPAL_TYPE) groups.get(ref).principalTx.push(tx);
    else if (t === VAT_TYPE) groups.get(ref).vatTx.push(tx);
  }

  return unmatchedBankRows;
}

function reconcileGroup(key, group) {
  const isAvansGroup = key.startsWith('__avans__');
  const originalEqs = group.eqs.slice();
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

  const pTx = group.principalTx.slice().sort((a, b) => cmpDate(a.tarix, b.tarix));
  const vTx = group.vatTx.slice().sort((a, b) => cmpDate(a.tarix, b.tarix));

  if (!isAvansGroup) {
    allocateFifo(work, pTx, '_principalOwed', '_principalPaid', '_principalDateRaw');
    allocateFifo(work, vTx, '_vatOwed', '_vatPaid', '_vatDateRaw');
  }

  const updatedRowsById = new Map();
  for (let i = 0; i < work.length; i++) {
    const w = work[i];
    const eq = updatable[i];
    const base = toBaseRow(eq);
    const principalChanged = round2(w._principalPaid - base.odenisMeblegEsas) > EPS;
    const vatChanged = round2(w._vatPaid - base.odenisMeblegEdv) > EPS;
    const status = buildStatus(w._principalOwed, w._vatOwed, w._principalPaid, w._vatPaid);
    const rowColor = status === STATUS.PAID && (principalChanged || vatChanged)
      ? ROW_COLOR.GREEN
      : '';

    updatedRowsById.set(String(eq._id), {
      reklamYayicisi: w.reklamYayicisi,
      voen: w.voen,
      icazeNo: w.icazeNo,
      eqTarixi: w.eqTarixi,
      eqNomresi: w.eqNomresi,
      eqMeblegEsas: round2(w.eqMeblegEsas),
      eqMeblegEdv: round2(w.eqMeblegEdv),
      odenisTarixi: displayDate(w._principalDateRaw),
      odenisMeblegEsas: round2(w._principalPaid),
      odenisTarixiEdv: displayDate(w._vatDateRaw),
      odenisMeblegEdv: round2(w._vatPaid),
      qeyd: w.qeyd,
      status,
      _rowColor: rowColor,
      _changed: principalChanged || vatChanged,
      _matched: pTx.length > 0 || vTx.length > 0,
      _remainingPrincipal: round2(w._principalOwed),
      _remainingVat: round2(w._vatOwed),
    });
  }

  const merged = [];
  for (const eq of originalEqs) {
    const id = String(eq._id);
    if (hasDate(eq.odenisTarixi)) {
      if (frozenRowsById.has(id)) merged.push(frozenRowsById.get(id));
      continue;
    }
    if (!updatedRowsById.has(id)) continue;

    const updated = updatedRowsById.get(id);
    merged.push(updated);

    const remaining = updated._remainingPrincipal > EPS || updated._remainingVat > EPS;
    const isUnsettled =
      updated.status === STATUS.PARTIAL ||
      updated.status === STATUS.PRINCIPAL_UNPAID ||
      updated.status === STATUS.VAT_UNPAID;

    if (isUnsettled && remaining) {
      merged.push({
        reklamYayicisi: '',
        voen: '',
        icazeNo: '',
        eqTarixi: '',
        eqNomresi: '',
        eqMeblegEsas: updated._remainingPrincipal > EPS ? updated._remainingPrincipal : 0,
        eqMeblegEdv: updated._remainingVat > EPS ? updated._remainingVat : 0,
        odenisTarixi: '',
        odenisMeblegEsas: 0,
        odenisTarixiEdv: '',
        odenisMeblegEdv: 0,
        qeyd: updated.qeyd || '',
        status: STATUS.DEBT,
        _rowColor: ROW_COLOR.RED,
        _changed: true,
        _matched: true,
      });
    }
  }

  const pLeft = isAvansGroup ? [] : pTx.filter(x => x.remaining > EPS);
  const vLeft = isAvansGroup ? [] : vTx.filter(x => x.remaining > EPS);

  const principalOver = round2(pLeft.reduce((s, x) => s + x.remaining, 0));
  const vatOver = round2(vLeft.reduce((s, x) => s + x.remaining, 0));

  if (principalOver > EPS || vatOver > EPS) {
    const lastP = pLeft.length ? pLeft[pLeft.length - 1] : null;
    const lastV = vLeft.length ? vLeft[vLeft.length - 1] : null;
    const overpayQeyd = (originalEqs.find(x => String(x.qeyd || '') !== '')?.qeyd) || '';
    const sourceEq =
      originalEqs.find(x => (x.reklamYayicisi || '').trim() || (x.voen || '').trim()) ||
      originalEqs[0] ||
      {};

    merged.push({
      reklamYayicisi: sourceEq.reklamYayicisi || '',
      voen: sourceEq.voen || '',
      icazeNo: key.startsWith('__no_icaze__') ? '' : key,
      eqTarixi: '',
      eqNomresi: '',
      eqMeblegEsas: 0,
      eqMeblegEdv: 0,
      odenisTarixi: displayDate(lastP ? lastP.tarix : ''),
      odenisMeblegEsas: principalOver,
      odenisTarixiEdv: displayDate(lastV ? lastV.tarix : ''),
      odenisMeblegEdv: vatOver,
      qeyd: overpayQeyd,
      status: STATUS.OVERPAYMENT,
      _rowColor: ROW_COLOR.YELLOW,
      _changed: true,
      _matched: true,
    });
  }

  return merged;
}

function buildRows(eqData, bankData) {
  const groups = groupEqs(eqData);
  const unmatchedBankRows = distributeBank(bankData, groups);

  const rows = [];
  for (const [key, group] of groups) {
    rows.push(...reconcileGroup(key, group));
  }
  rows.push(...unmatchedBankRows);
  return rows;
}

const EXCEL_HEADERS = [
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
  'Status',
];

const EXCEL_COLUMNS = [
  { width: 40 }, { width: 16 }, { width: 18 }, { width: 20 }, { width: 26 },
  { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 },
  { width: 18 }, { width: 20 }, { width: 18 },
];

const NUMERIC_COL_INDEXES = [6, 7, 9, 11];

function rowToExcelValues(r) {
  return [
    r.reklamYayicisi,
    r.voen,
    r.icazeNo,
    r.eqTarixi,
    r.eqNomresi,
    round2(r.eqMeblegEsas),
    round2(r.eqMeblegEdv),
    r.odenisTarixi,
    round2(r.odenisMeblegEsas),
    r.odenisTarixiEdv,
    round2(r.odenisMeblegEdv),
    r.qeyd,
    r.status,
  ];
}

function applyRowFill(row, colorKey) {
  const argb = FILL[colorKey];
  if (!argb) return;
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  });
}

function filterExportRows(rows, onlyUnpaid) {
  if (!onlyUnpaid) return rows;
  const hasAnyDate = r => String(r.odenisTarixi || '').trim() || String(r.odenisTarixiEdv || '').trim();
  return rows.filter(r =>
    (r._matched && r._changed && (hasAnyDate(r) || r.status === STATUS.DEBT)) ||
    r.status === STATUS.NO_MATCH
  );
}

async function buildExcel(rows, onlyUnpaid) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Uzlaşma');
  const exportRows = filterExportRows(rows, onlyUnpaid);

  ws.addRow(EXCEL_HEADERS);
  ws.columns = EXCEL_COLUMNS;

  const headerRow = ws.getRow(1);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, name: 'Arial', size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.HEADER } };
  });

  for (const r of exportRows) {
    const row = ws.addRow(rowToExcelValues(r));
    NUMERIC_COL_INDEXES.forEach(idx => {
      row.getCell(idx).numFmt = '0.00';
    });
    applyRowFill(row, r._rowColor);
  }

  ws.eachRow(row => {
    row.eachCell(cell => {
      cell.font = { ...(cell.font || {}), name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });
  });

  return wb.xlsx.writeBuffer();
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
    const scope = String(req.query.scope || 'changed').toLowerCase();
    const onlyUnpaid = scope !== 'all';
    const buf = await buildExcel(rows, onlyUnpaid);
    res.setHeader('Content-Disposition', 'attachment; filename=uzlasma.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }

  return res.json({ rows });
};

module.exports.STATUS = STATUS;
module.exports.buildRows = buildRows;
module.exports.buildExcel = buildExcel;
module.exports.safeNum = safeNum;
module.exports.round2 = round2;
module.exports.displayDate = displayDate;
module.exports.normDate = normDate;
module.exports.cmpDate = cmpDate;
