const mongoose = require('mongoose');

const elektronQaimeSchema = new mongoose.Schema({
  reklamYayicisi: { type: String, trim: true },
  voen: { type: String, trim: true },
  icazeNo: { type: String, trim: true },
  eqTarixi: { type: String },
  eqNomresi: { type: String, trim: true },
  eqMeblegEsas: { type: Number, default: 0 },
  eqMeblegEdv: { type: Number, default: 0 },
  odenisTarixi: { type: String },
  odenisMeblegEsas: { type: Number, default: 0 },
  odenisTarixiEdv: { type: String },
  odenisMeblegEdv: { type: Number, default: 0 },
  qeyd: { type: String },
}, { timestamps: true });

const bankHesabSchema = new mongoose.Schema({
  bankHesab: { type: String, trim: true },
  tarix: { type: String },
  odeyiciVesait: { type: String, trim: true },
  medaxil: { type: Number, default: 0 },
  mexaric: { type: Number, default: 0 },
  qeyd: { type: String },
  muracietNomresiEqfNomresi: { type: String, trim: true },
  hesabatUzreTeyinat: { type: String, trim: true },
  voen: { type: String, trim: true },
}, { timestamps: true });

elektronQaimeSchema.index({ createdAt: 1, _id: 1 });
bankHesabSchema.index({ createdAt: 1, _id: 1 });

const ElektronQaime = mongoose.models.ElektronQaime || mongoose.model('ElektronQaime', elektronQaimeSchema);
const BankHesab = mongoose.models.BankHesab || mongoose.model('BankHesab', bankHesabSchema);

module.exports = { ElektronQaime, BankHesab };
