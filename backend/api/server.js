require('dotenv').config();
const app = require('./src/app');
const { pool } = require('./src/config/database');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Starting graceful shutdown...');
    
    server.close(async () => {
        logger.info('HTTP server closed');
        await pool.end();
        logger.info('Database pool closed');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received. Starting graceful shutdown...');
    
    server.close(async () => {
        logger.info('HTTP server closed');
        await pool.end();
        logger.info('Database pool closed');
        process.exit(0);
    });
});

// Start server
const server = app.listen(PORT, HOST, () => {
    logger.info(`
    ╔══════════════════════════════════════════╗
    ║  SMART SME MANAGER API                  ║
    ║  Environment: ${process.env.NODE_ENV}                    ║
    ║  Server: http://${HOST}:${PORT}              ║
    ║  Database: ${process.env.DB_NAME}                    ║
    ║  Started: ${new Date().toISOString()}  ║
    ╚══════════════════════════════════════════╝
    `);
});

module.exports = server;