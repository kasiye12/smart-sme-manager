const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { I18n } = require('i18n');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const customerRoutes = require('./routes/customers');
const inventoryRoutes = require('./routes/inventory');
const reportRoutes = require('./routes/reports');
const syncRoutes = require('./routes/sync');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/logger');

const app = express();

// ============================================
// SECURITY MIDDLEWARE
// ============================================
app.use(helmet({
    contentSecurityPolicy: false, // Adjust for your needs
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language', 'X-Device-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 600
}));

// ============================================
// RATE LIMITING
// ============================================
const globalLimiter = rateLimit({
    windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX || 1000,
    message: {
        error: 'Too many requests',
        message: 'Please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(globalLimiter);

// ============================================
// BODY PARSING & COMPRESSION
// ============================================
app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ============================================
// LOCALIZATION (i18n)
// ============================================
const i18n = new I18n({
    locales: ['en', 'am', 'or', 'ti', 'so'],
    defaultLocale: 'am',
    directory: path.join(__dirname, 'locales'),
    objectNotation: true,
    updateFiles: false,
    api: {
        '__': 'translate',
        '__n': 'translateN'
    }
});

app.use(i18n.init);

// ============================================
// LOGGING
// ============================================
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
}
app.use(requestLogger);

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', async (req, res) => {
    const db = require('./config/database');
    const dbHealth = await db.healthCheck();
    
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbHealth,
        memory: process.memoryUsage()
    });
});

// ============================================
// API ROUTES
// ============================================
app.use('/api/v2/auth', authRoutes);
app.use('/api/v2/products', productRoutes);
app.use('/api/v2/sales', salesRoutes);
app.use('/api/v2/customers', customerRoutes);
app.use('/api/v2/inventory', inventoryRoutes);
app.use('/api/v2/reports', reportRoutes);
app.use('/api/v2/sync', syncRoutes);

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`
    });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use(errorHandler);

module.exports = app;