const connectDB = require('../_db');
const { ElektronQaime } = require('../_models');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  await connectDB();

  try {
    const docs = await parseBody(req);
    if (!Array.isArray(docs)) return res.status(400).json({ error: 'Array gözlənilir' });
    try {
      const inserted = await ElektronQaime.insertMany(docs, { ordered: false });
      return res.json({ imported: inserted.length, failed: 0, total: docs.length });
    } catch (err) {
      const imported = Array.isArray(err.insertedDocs) ? err.insertedDocs.length : 0;
      const failed = Math.max(0, docs.length - imported);
      return res.status(200).json({ imported, failed, total: docs.length, error: err.message });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
