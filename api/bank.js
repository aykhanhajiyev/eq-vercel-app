const connectDB = require('./_db');
const { BankHesab } = require('./_models');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectDB();

  if (req.method === 'GET') {
    const { search = '', page = 1, limit = 50 } = req.query;
    let filter = {};
    if (search) {
      filter.$or = [
        { voen: { $regex: search, $options: 'i' } },
        { bankHesab: { $regex: search, $options: 'i' } },
        { odeyiciVesait: { $regex: search, $options: 'i' } },
        { muracietNomresiEqfNomresi: { $regex: search, $options: 'i' } },
      ];
    }
    const total = await BankHesab.countDocuments(filter);
    const data = await BankHesab.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((page - 1) * Number(limit))
      .limit(Number(limit));
    return res.json({ data, total, page: Number(page), pages: Math.ceil(total / limit) });
  }

  if (req.method === 'POST') {
    const doc = await BankHesab.create(req.body);
    return res.json(doc);
  }

  res.status(405).json({ error: 'Method not allowed' });
};
