const { Pool } = require('pg');

// Create connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false  // Required for Neon.tech and Render
    },
    max: 20, // Maximum number of clients
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Test connection on startup
pool.on('connect', () => {
    console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database error:', err.message);
});

// Query helper function
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('Query executed', { text: text.substring(0, 50), duration, rows: result.rowCount });
        return result;
    } catch (error) {
        console.error('Query error:', error.message);
        throw error;
    }
}

// Transaction helper
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Health check
async function healthCheck() {
    try {
        const result = await pool.query('SELECT NOW() as current_time');
        return {
            status: 'healthy',
            timestamp: result.rows[0].current_time,
            poolSize: pool.totalCount,
            idleConnections: pool.idleCount
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message
        };
    }
}

// Graceful shutdown
async function close() {
    await pool.end();
    console.log('Database pool closed');
}

module.exports = {
    pool,
    query,
    transaction,
    healthCheck,
    close
};