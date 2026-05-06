const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

pool.query(schema)
    .then(() => {
        console.log('Database tables created successfully');
        pool.end();
    })
    .catch(err => {
        console.error('Schema error:', err.message);
        pool.end();
    });
