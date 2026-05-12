const connectDB = require('./_db');
const { ElektronQaime } = require('./_models');

const ADMIN_PASSWORD = 'Aslan123@';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectDB();

  if (req.method === 'GET') {
    const { search = '', page = 1, limit = 50 } = req.query;
    let filter = {};
    if (search) {
      filter.$or = [
        { voen: { $regex: search, $options: 'i' } },
        { icazeNo: { $regex: search, $options: 'i' } },
        { qeyd: { $regex: search, $options: 'i' } },
      ];
    }
    const total = await ElektronQaime.countDocuments(filter);
    const data = await ElektronQaime.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .allowDiskUse(true)
      .skip((page - 1) * Number(limit))
      .limit(Number(limit));
    return res.json({ data, total, page: Number(page), pages: Math.ceil(total / limit) });
  }

  if (req.method === 'POST') {
    const doc = await ElektronQaime.create(req.body);
    return res.json(doc);
  }

  if (req.method === 'DELETE') {
    const password = (req.body && req.body.password) || '';
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Şifrə səhvdir' });
    }
    const result = await ElektronQaime.deleteMany({});
    return res.json({ success: true, deleted: result.deletedCount });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
