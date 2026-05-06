const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// SSL configuration for production
const sslConfig = process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(__dirname, '../../certs/ca-certificate.crt')).toString()
} : false;

// Create connection pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: process.env.DB_POOL_MAX || 20,
    min: process.env.DB_POOL_MIN || 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: sslConfig
});

// Pool event handlers
pool.on('connect', (client) => {
    console.log('New client connected to database');
    
    // Set default schema permissions
    client.query('SET search_path TO public');
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Query helper with automatic security context
async function query(text, params, businessId = null) {
    const client = await pool.connect();
    try {
        if (businessId) {
            await client.query(
                "SELECT set_config('app.current_business_id', $1::text, false)",
                [businessId]
            );
        }
        
        const result = await client.query(text, params);
        return result;
    } finally {
        client.release();
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

module.exports = {
    pool,
    query,
    transaction,
    healthCheck
};