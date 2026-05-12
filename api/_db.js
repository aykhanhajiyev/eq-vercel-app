const mongoose = require('mongoose');
const { ElektronQaime, BankHesab } = require('./_models');

let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null, indexesPromise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const uri = 'mongodb+srv://rzayevsamir223_db_user:Samir123456789@cluster0.d0vschl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
    });
  }
  cached.conn = await cached.promise;
  if (!cached.indexesPromise) {
    cached.indexesPromise = Promise.all([
      ElektronQaime.createIndexes(),
      BankHesab.createIndexes(),
    ]);
  }
  await cached.indexesPromise;
  return cached.conn;
}

module.exports = connectDB;
