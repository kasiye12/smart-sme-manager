const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'smart_sme_manager',
    user: process.env.DB_USER || 'sme_admin',
    password: process.env.DB_PASSWORD || 'Kasu1122',
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false
});

module.exports = pool;
