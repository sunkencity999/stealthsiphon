/**
 * Database export (used by the web UI). Connections are created once per
 * distinct config and reused. Mongo/MySQL can also be configured from env
 * (MONGODB_URL / MYSQL_URL) so credentials need not be sent per request.
 */
const config = require('./config');
const store = require('./core/store');
const { SiphonError, E } = require('./core/errors');

const mongoClients = new Map();
const mysqlPools = new Map();

async function mongoModel(connectionString) {
    if (!mongoClients.has(connectionString)) {
        const mongoose = require('mongoose');
        const conn = mongoose.createConnection(connectionString, { serverSelectionTimeoutMS: 8000 });
        const p = conn.asPromise().then(c => c.model('ScrapedData', new mongoose.Schema({
            url: String, data: mongoose.Schema.Types.Mixed, timestamp: { type: Date, default: Date.now },
        })));
        p.catch(() => mongoClients.delete(connectionString));
        mongoClients.set(connectionString, p);
    }
    return mongoClients.get(connectionString);
}

async function mysqlPool(cfg) {
    const key = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
    if (!mysqlPools.has(key)) {
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool(typeof cfg === 'string' ? cfg : { ...cfg, connectionLimit: 3 });
        const p = pool.execute(`CREATE TABLE IF NOT EXISTS scraped_data (
            id INT AUTO_INCREMENT PRIMARY KEY, url VARCHAR(2048), data LONGTEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).then(() => pool);
        p.catch(() => mysqlPools.delete(key));
        mysqlPools.set(key, p);
    }
    return mysqlPools.get(key);
}

async function exportRecord({ url, data, dbType, connectionConfig }) {
    if (!url || data === undefined) throw new SiphonError(E.BAD_REQUEST, 'url and data are required', { status: 400 });
    switch (dbType) {
        case 'sqlite':
            return { id: store.exportsTable.insert(url, data), target: 'sqlite' };
        case 'mongodb': {
            const cs = (connectionConfig && connectionConfig.connectionString) || config.mongoUrl;
            if (!cs) throw new SiphonError(E.BAD_REQUEST, 'MongoDB connection string is required (or set MONGODB_URL)', { status: 400 });
            const Model = await mongoModel(cs);
            const doc = await new Model({ url, data }).save();
            return { id: String(doc._id), target: 'mongodb' };
        }
        case 'mysql': {
            const cfg = (connectionConfig && Object.keys(connectionConfig).length ? connectionConfig : null) || config.mysqlUrl;
            if (!cfg) throw new SiphonError(E.BAD_REQUEST, 'MySQL connection config is required (or set MYSQL_URL)', { status: 400 });
            const pool = await mysqlPool(cfg);
            const [rows] = await pool.execute('INSERT INTO scraped_data (url, data) VALUES (?, ?)', [url, JSON.stringify(data)]);
            return { id: rows.insertId, target: 'mysql' };
        }
        default:
            throw new SiphonError(E.BAD_REQUEST, 'dbType must be sqlite, mongodb, or mysql', { status: 400 });
    }
}

async function closeAll() {
    for (const p of mongoClients.values()) { try { const m = await p; await m.db.close(); } catch { /* ignore */ } }
    for (const p of mysqlPools.values()) { try { await (await p).end(); } catch { /* ignore */ } }
    mongoClients.clear();
    mysqlPools.clear();
}

module.exports = { exportRecord, closeAll };
