const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const https = require('https');
const url = require('url');
//const Sentry = require('@sentry/node');

// ✅ 1. Initialize Sentry FIRST - before creating the app
// Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

// ✅ 2. Sentry request handler - after app, before routes
//app.use(Sentry.Handlers.requestHandler());

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const META_API_VERSION = 'v18.0';

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'my-super-secret-key-2026';

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => console.error('Unexpected pool error:', err));

// Initialize database connection
(async () => {
    try {
        const res = await pool.query('SELECT NOW()');
        console.log('✅ Database connected at:', res.rows[0].now);
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    }
})();

app.get('/', (req, res) => {
    res.json({ 
        message: 'Smart SME Manager API Running',
        version: '2.0.0',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// HELPER: Get Ethiopian Date (FIXED)
// ============================================
function getEthiopianDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    
    let ethYear, ethMonth, ethDay;
    
    if (month > 9 || (month === 9 && day >= 11)) {
        ethYear = year - 8;
        ethMonth = month - 8;
        ethDay = day - 10;
    } else {
        ethYear = year - 7;
        ethMonth = month + 4;
        ethDay = day;
    }
    
    if (ethDay <= 0) {
        ethMonth--;
        if (ethMonth <= 0) {
            ethMonth = 13;
            ethYear--;
        }
        ethDay = 30 + ethDay;
    }
    
    if (ethMonth > 13) {
        ethMonth -= 13;
        ethYear++;
    }
    
    const ethMonths = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];
    const ethMonthsAm = ['መስከረም', 'ጥቅምት', 'ህዳር', 'ታህሳስ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዚያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];
    
    const monthIndex = Math.max(0, Math.min(12, ethMonth - 1));
    
    return {
        en: `${ethDay} ${ethMonths[monthIndex]} ${ethYear}`,
        am: `${ethDay} ${ethMonthsAm[monthIndex]} ${ethYear}`,
        day: ethDay,
        month: ethMonth,
        year: ethYear,
        monthNameEn: ethMonths[monthIndex],
        monthNameAm: ethMonthsAm[monthIndex]
    };
}

// ============================================
// Telegram Helper Functions
// ============================================
async function sendTelegramMessage(chatId, message, parseMode = 'HTML') {
    try {
        const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: parseMode,
                disable_web_page_preview: true
            })
        });
        const result = await response.json();
        return { success: result.ok, result };
    } catch (error) {
        console.error('Telegram send error:', error);
        return { success: false, error: error.message };
    }
}

async function sendTelegramKeyboard(chatId, message, buttons, parseMode = 'HTML') {
    try {
        const keyboard = { inline_keyboard: buttons };
        const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: parseMode,
                reply_markup: keyboard
            })
        });
        const result = await response.json();
        return { success: result.ok, result };
    } catch (error) {
        console.error('Telegram keyboard send error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// WhatsApp Helper Function
// ============================================
async function sendWhatsAppMessage(to, message) {
    try {
        let formattedTo = to.replace(/\D/g, '');
        if (formattedTo.startsWith('0')) {
            formattedTo = '251' + formattedTo.substring(1);
        }
        if (!formattedTo.startsWith('251')) {
            formattedTo = '251' + formattedTo;
        }
        
        const response = await fetch(
            `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: formattedTo,
                    type: 'text',
                    text: { preview_url: false, body: message }
                })
            }
        );
        
        const result = await response.json();
        if (result.error) {
            console.error('Meta API Error:', result.error);
            return { success: false, error: result.error.message };
        }
        return { success: true, messageId: result.messages?.[0]?.id };
    } catch (error) {
        console.error('WhatsApp send error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// AUTH MIDDLEWARE
// ============================================
const authenticate = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: 'Access denied. Insufficient permissions.',
                required_roles: roles,
                user_role: req.user.role
            });
        }
        next();
    };
};

// ============================================
// AUTH ENDPOINTS
// ============================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { business_name, owner_name, phone, password } = req.body;
        
        if (!business_name || !owner_name || !phone || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        
        const check = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: 'Phone already registered' });
        }
        
        const bizResult = await pool.query(
            'INSERT INTO businesses (name, owner_name, phone) VALUES ($1, $2, $3) RETURNING id', 
            [business_name, owner_name, phone]
        );
        const businessId = bizResult.rows[0].id;
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const userResult = await pool.query(
            'INSERT INTO users (business_id, full_name, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [businessId, owner_name, phone, hashedPassword, 'owner']
        );
        
        try {
            await pool.query(
                'INSERT INTO clients (business_name, owner_name, phone, subscription_plan) VALUES ($1, $2, $3, $4) ON CONFLICT (phone) DO NOTHING',
                [business_name, owner_name, phone, 'trial']
            );
        } catch (e) {
            console.log('Client sync:', e.message);
        }
        
        const token = jwt.sign(
            { id: userResult.rows[0].id, business_id: businessId, role: 'owner' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.status(201).json({ 
            success: true, 
            message: 'Business registered successfully', 
            token, 
            business_id: businessId 
        });
    } catch (error) {
        console.error('Register error:', error.message);
        res.status(500).json({ error: 'Registration failed', detail: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password) {
            return res.status(400).json({ error: 'Phone and password required' });
        }
        
        const result = await pool.query(
            `SELECT u.*, b.is_active as biz_active, b.name as business_name 
             FROM users u JOIN businesses b ON u.business_id = b.id 
             WHERE u.phone = $1`, [phone]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
        if (!user.biz_active) return res.status(403).json({ error: 'Business account deactivated' });
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
        
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        
        const token = jwt.sign(
            { id: user.id, business_id: user.business_id, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ 
            success: true, 
            token, 
            user: { 
                id: user.id, 
                name: user.full_name, 
                business_name: user.business_name, 
                role: user.role 
            } 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', detail: error.message });
    }
});

app.put('/api/auth/change-password', authenticate, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Current and new password required' });
        }
        if (new_password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        
        const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const validPassword = await bcrypt.compare(current_password, user.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Current password is incorrect' });
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);
        
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// BUSINESS PROFILE & SETTINGS
// ============================================
app.get('/api/business/profile', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, owner_name, phone, email, city, tin_number, tax_type, tax_rate, 
                    show_tax_on_receipt, subscription_tier 
             FROM businesses WHERE id = $1`,
            [req.user.business_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Business not found' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/business/profile', authenticate, async (req, res) => {
    try {
        const { name, owner_name, phone, email, city } = req.body;
        
        const result = await pool.query(
            `UPDATE businesses SET 
                name = COALESCE($1, name),
                owner_name = COALESCE($2, owner_name),
                phone = COALESCE($3, phone),
                email = COALESCE($4, email),
                city = COALESCE($5, city),
                updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [name, owner_name, phone, email, city, req.user.business_id]
        );
        
        res.json({ success: true, business: result.rows[0], message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/business/settings', authenticate, async (req, res) => {
    try {
        const { tax_type, tax_rate, tin_number, show_tax_on_receipt } = req.body;
        const businessId = req.user.business_id;
        
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        if (tax_type !== undefined) {
            updates.push(`tax_type = $${paramCount++}`);
            values.push(tax_type);
        }
        if (tax_rate !== undefined) {
            updates.push(`tax_rate = $${paramCount++}`);
            values.push(tax_rate);
        }
        if (tin_number !== undefined) {
            updates.push(`tin_number = $${paramCount++}`);
            values.push(tin_number);
        }
        if (show_tax_on_receipt !== undefined) {
            updates.push(`show_tax_on_receipt = $${paramCount++}`);
            values.push(show_tax_on_receipt);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        values.push(businessId);
        const query = `UPDATE businesses SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        
        const result = await pool.query(query, values);
        
        res.json({ success: true, message: 'Settings updated successfully', business: result.rows[0] });
    } catch (error) {
        console.error('Settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get tax settings
app.get('/api/business/tax-settings', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT tin_number, tax_type, tax_rate, show_tax_on_receipt FROM businesses WHERE id = $1',
            [req.user.business_id]
        );
        res.json({ settings: result.rows[0] || { tax_type: 'none', tax_rate: 0, show_tax_on_receipt: false } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PRODUCTS
// ============================================
app.get('/api/products', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM products WHERE business_id = $1 AND is_active = true ORDER BY created_at DESC`,
            [req.user.business_id]
        );
        res.json({ products: result.rows });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/products', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { name_translations, barcode, cost_price, selling_price, current_stock, unit, track_expiry, expiry_date, batch_number } = req.body;
        if (!name_translations || !cost_price || !selling_price) {
            return res.status(400).json({ error: 'Name, cost price, and selling price required' });
        }
        const result = await pool.query(
            `INSERT INTO products (business_id, name_translations, barcode, cost_price, selling_price, current_stock, unit, track_expiry, expiry_date, batch_number) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [req.user.business_id, JSON.stringify(name_translations), barcode, cost_price, selling_price, 
             current_stock || 0, unit || 'piece', track_expiry || false, expiry_date || null, batch_number || null]
        );
        res.status(201).json({ success: true, product_id: result.rows[0].id });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.put('/api/products/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name_translations, barcode, cost_price, selling_price, current_stock, unit, category_id, track_expiry, expiry_date, batch_number } = req.body;
        
        const result = await pool.query(
            `UPDATE products SET 
                name_translations = COALESCE($1, name_translations),
                barcode = COALESCE($2, barcode),
                cost_price = COALESCE($3, cost_price),
                selling_price = COALESCE($4, selling_price),
                current_stock = COALESCE($5, current_stock),
                unit = COALESCE($6, unit),
                category_id = COALESCE($7, category_id),
                track_expiry = COALESCE($8, track_expiry),
                expiry_date = COALESCE($9, expiry_date),
                batch_number = COALESCE($10, batch_number),
                updated_at = NOW()
             WHERE id = $11 AND business_id = $12 RETURNING *`,
            [name_translations ? JSON.stringify(name_translations) : null, barcode, cost_price, selling_price, 
             current_stock, unit, category_id, track_expiry, expiry_date, batch_number, id, req.user.business_id]
        );
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
        res.json({ success: true, product: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/products/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id',
            [id, req.user.business_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
        res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CUSTOMERS
// ============================================
app.post('/api/customers', authenticate, async (req, res) => {
  try {
    const { 
      full_name, phone, credit_limit, 
      email, address, notes, preferred_contact_method, credit_score 
    } = req.body;
    
    if (!full_name) return res.status(400).json({ error: 'Name required' });
    
    const result = await pool.query(
      `INSERT INTO customers (
        business_id, full_name, phone, credit_limit, 
        email, address, notes, preferred_contact_method, credit_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        req.user.business_id, full_name, phone || null, credit_limit || 0,
        email || null, address || null, notes || null, 
        preferred_contact_method || 'sms', credit_score || 0
      ]
    );
    res.status(201).json({ success: true, customer_id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/customers', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, phone, email, address, credit_limit, 
              current_balance, credit_score, telegram_chat_id, 
              preferred_contact_method, notes, is_active, created_at
       FROM customers 
       WHERE business_id = $1 AND is_active = true 
       ORDER BY full_name`,
      [req.user.business_id]
    );
    res.json({ customers: result.rows });
  } catch (error) { 
    res.status(500).json({ error: error.message }); 
  }
});

app.put('/api/customers/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      full_name, phone, credit_limit, 
      email, address, notes, preferred_contact_method, credit_score 
    } = req.body;
    
    const result = await pool.query(
      `UPDATE customers SET 
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        credit_limit = COALESCE($3, credit_limit),
        email = COALESCE($4, email),
        address = COALESCE($5, address),
        notes = COALESCE($6, notes),
        preferred_contact_method = COALESCE($7, preferred_contact_method),
        credit_score = COALESCE($8, credit_score),
        updated_at = NOW()
      WHERE id = $9 AND business_id = $10 RETURNING *`,
      [
        full_name, phone, credit_limit, 
        email, address, notes, 
        preferred_contact_method, credit_score,
        id, req.user.business_id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json({ success: true, customer: result.rows[0], message: 'Customer updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/customers/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'UPDATE customers SET is_active = false, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id',
            [id, req.user.business_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
        res.json({ success: true, message: 'Customer deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/customers/:id/payment', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, payment_method } = req.body;
        
        const customer = await pool.query('SELECT * FROM customers WHERE id = $1 AND business_id = $2', [id, req.user.business_id]);
        if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
        
        const newBalance = customer.rows[0].current_balance - parseFloat(amount);
        await pool.query('UPDATE customers SET current_balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, id]);
        await pool.query(
            `INSERT INTO credit_transactions (business_id, customer_id, user_id, transaction_type, amount, balance_after, payment_method) 
             VALUES ($1, $2, $3, 'payment', $4, $5, $6)`,
            [req.user.business_id, id, req.user.id, amount, newBalance, payment_method || 'cash']
        );
        
        res.json({ success: true, new_balance: newBalance, message: 'Payment recorded' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/customers/:id/history', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT * FROM credit_transactions WHERE customer_id = $1 AND business_id = $2 ORDER BY created_at DESC`,
            [id, req.user.business_id]
        );
        res.json({ transactions: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SALES
// ============================================
app.post('/api/sales', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { items, customer_id, payment_method, amount_paid, payment_status, guarantor_name, guarantor_phone, guarantor_id_number, tax_rate, subtotal: reqSubtotal, tax_amount: reqTaxAmount } = req.body;
        
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'No items in sale' });
        }
        
        const businessResult = await client.query(
            'SELECT tax_type, tax_rate, tin_number, show_tax_on_receipt, name FROM businesses WHERE id = $1',
            [req.user.business_id]
        );
        const business = businessResult.rows[0];
        const taxType = business?.tax_type || 'none';
        const businessTaxRate = business?.tax_rate || 0;
        
        const effectiveTaxRate = tax_rate !== undefined ? tax_rate : businessTaxRate;
        
        let subtotal = 0;
        const saleItems = [];
        
        for (const item of items) {
            const prodResult = await client.query(
                'SELECT * FROM products WHERE id = $1 AND business_id = $2',
                [item.product_id, req.user.business_id]
            );
            if (prodResult.rows.length === 0) throw new Error('Product not found');
            const product = prodResult.rows[0];
            
            if (product.current_stock < item.quantity) throw new Error(`Insufficient stock for ${product.name_translations?.en || 'product'}`);
            if (product.track_expiry === true && product.expiry_date && new Date(product.expiry_date) < new Date()) {
                throw new Error(`Cannot sell expired product: ${product.name_translations?.en || 'product'}`);
            }
            
            const itemTotal = product.selling_price * item.quantity;
            subtotal += itemTotal;
            saleItems.push({
                product_id: product.id, quantity: item.quantity,
                unit_price: product.selling_price, cost_price: product.cost_price, total_price: itemTotal
            });
        }
        
        let taxAmount = reqTaxAmount !== undefined ? reqTaxAmount : 0;
        if (reqTaxAmount === undefined) {
            switch (taxType) {
                case 'vat_15': taxAmount = parseFloat((subtotal * 0.15).toFixed(2)); break;
                case 'tot_2': taxAmount = parseFloat((subtotal * 0.02).toFixed(2)); break;
                case 'custom': taxAmount = parseFloat((subtotal * (effectiveTaxRate / 100)).toFixed(2)); break;
                default: taxAmount = 0;
            }
        }
        
        const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));
        const saleNumber = 'INV-' + Date.now();
        const isCredit = payment_status === 'credit' || payment_method === 'credit';
        const paidAmount = isCredit ? 0 : (amount_paid || totalAmount);
        const ethiopianDate = getEthiopianDate();
        
        const saleResult = await client.query(
            `INSERT INTO sales (
                business_id, user_id, customer_id, sale_number, sale_date, ethiopian_date,
                subtotal, discount_amount, tax_amount, total_amount, amount_paid, 
                payment_status, payment_method, status
            ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8, $9, $10, $11, $12, 'completed') RETURNING id`,
            [req.user.business_id, req.user.id, customer_id || null, saleNumber, JSON.stringify(ethiopianDate),
             subtotal, 0, taxAmount, totalAmount, paidAmount, isCredit ? 'credit' : 'paid', payment_method || 'cash']
        );
        
        const saleId = saleResult.rows[0].id;
        
        for (const item of saleItems) {
            await client.query(
                `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, total_price) VALUES ($1, $2, $3, $4, $5, $6)`,
                [saleId, item.product_id, item.quantity, item.unit_price, item.cost_price, item.total_price]
            );
            await client.query('UPDATE products SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
            
            await client.query(
                `INSERT INTO stock_transactions (business_id, product_id, user_id, transaction_type, quantity, notes)
                 VALUES ($1, $2, $3, 'sale', $4, $5)`,
                [req.user.business_id, item.product_id, req.user.id, -item.quantity, `Sale ${saleNumber}`]
            );
        }
        
        let customerName = null;
        if (isCredit && customer_id) {
            await client.query('UPDATE customers SET current_balance = current_balance + $1, updated_at = NOW() WHERE id = $2', [totalAmount, customer_id]);
            const custResult = await client.query('SELECT current_balance, full_name FROM customers WHERE id = $1', [customer_id]);
            customerName = custResult.rows[0]?.full_name;
            
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);
            
            await client.query(
                `INSERT INTO credit_transactions (
                    business_id, customer_id, sale_id, user_id, transaction_type, 
                    amount, balance_after, due_days, due_date,
                    guarantor_name, guarantor_phone, guarantor_id_number
                ) VALUES ($1, $2, $3, $4, 'credit', $5, $6, $7, $8, $9, $10, $11)`,
                [req.user.business_id, customer_id, saleId, req.user.id, totalAmount, custResult.rows[0].current_balance, 30, dueDate.toISOString().split('T')[0], guarantor_name || null, guarantor_phone || null, guarantor_id_number || null]
            );
        }
        
        await client.query(
            `INSERT INTO action_logs (business_id, user_id, action_type, entity_type, entity_id, details)
             VALUES ($1, $2, 'sale', 'sale', $3, $4)`,
            [req.user.business_id, req.user.id, saleId, JSON.stringify({ sale_number: saleNumber, total: totalAmount, is_credit: isCredit, tax_type: taxType, tax_amount: taxAmount })]
        );
        
        await client.query('COMMIT');
        
        res.status(201).json({ 
            success: true, sale_id: saleId, sale_number: saleNumber,
            total_amount: totalAmount, subtotal: subtotal, tax_amount: taxAmount,
            tax_type: taxType, tax_rate: effectiveTaxRate, items_sold: saleItems.length, is_credit: isCredit,
            ethiopian_date: ethiopianDate, customer_name: customerName,
            guarantor_name: guarantor_name || null,
            business_name: business.name
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Sale error:', error);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
});

app.get('/api/sales', authenticate, async (req, res) => {
    try {
        const { limit = 50, offset = 0, start_date, end_date, payment_status } = req.query;
        
        let query = `
            SELECT s.*, c.full_name as customer_name, u.full_name as cashier_name
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.business_id = $1 AND s.status = 'completed'
        `;
        const params = [req.user.business_id];
        let paramCount = 2;
        
        if (start_date) { query += ` AND s.sale_date >= $${paramCount++}`; params.push(start_date); }
        if (end_date) { query += ` AND s.sale_date <= $${paramCount++}`; params.push(end_date); }
        if (payment_status) { query += ` AND s.payment_status = $${paramCount++}`; params.push(payment_status); }
        
        query += ` ORDER BY s.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        res.json({ sales: result.rows, total: result.rowCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sales/:id/void', authenticate, authorize('owner', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { reason } = req.body;
        
        const sale = await client.query('SELECT * FROM sales WHERE id = $1 AND business_id = $2', [id, req.user.business_id]);
        if (sale.rows.length === 0) return res.status(404).json({ error: 'Sale not found' });
        if (sale.rows[0].status === 'voided') return res.status(400).json({ error: 'Sale already voided' });
        
        await client.query(
            `UPDATE sales SET status = 'voided', void_reason = $1, voided_by = $2, voided_at = NOW(), updated_at = NOW() WHERE id = $3`,
            [reason || 'No reason provided', req.user.id, id]
        );
        
        const items = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [id]);
        for (const item of items.rows) {
            await client.query('UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
        }
        
        if (sale.rows[0].customer_id && sale.rows[0].payment_status === 'credit') {
            await client.query('UPDATE customers SET current_balance = current_balance - $1, updated_at = NOW() WHERE id = $2', [sale.rows[0].total_amount - sale.rows[0].amount_paid, sale.rows[0].customer_id]);
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Sale voided successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
});

// ============================================
// REPORTS
// ============================================
app.get('/api/reports/daily', authenticate, async (req, res) => {
    try {
        const today = req.query.date || new Date().toISOString().split('T')[0];
        
        const salesResult = await pool.query(`
            SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(s.total_amount), 0) as total_revenue,
                COALESCE(SUM(s.tax_amount), 0) as total_tax,
                COUNT(DISTINCT s.customer_id) as unique_customers,
                COUNT(DISTINCT s.sale_date) as active_days,
                COALESCE(SUM(s.discount_amount), 0) as total_discounts
            FROM sales s
            WHERE s.business_id = $1 
            AND s.sale_date = $2 
            AND s.status = 'completed'
        `, [req.user.business_id, today]);
        
        const profitResult = await pool.query(`
            SELECT COALESCE(SUM(
                (si.unit_price - COALESCE(p.cost_price, 0)) * si.quantity
            ), 0) as gross_profit
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN products p ON si.product_id = p.id
            WHERE s.business_id = $1 
            AND s.sale_date = $2 
            AND s.status = 'completed'
        `, [req.user.business_id, today]);
        
        const expenseResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses
            FROM expenses 
            WHERE business_id = $1 AND expense_date = $2
        `, [req.user.business_id, today]);
        
        const paymentResult = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN LOWER(s.payment_method) = 'cash' THEN s.total_amount ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN LOWER(s.payment_method) IN ('telebirr', 'cbe_birr', 'cbe', 'bank_transfer', 'digital') THEN s.total_amount ELSE 0 END), 0) as electronic_sales,
                COALESCE(SUM(CASE WHEN LOWER(s.payment_status) = 'credit' THEN s.total_amount ELSE 0 END), 0) as credit_sales,
                COALESCE(SUM(CASE WHEN LOWER(s.payment_method) NOT IN ('cash', 'telebirr', 'cbe_birr', 'cbe', 'bank_transfer', 'digital') 
                    AND LOWER(s.payment_status) != 'credit' THEN s.total_amount ELSE 0 END), 0) as other_sales
            FROM sales s
            WHERE s.business_id = $1 
            AND s.sale_date = $2 
            AND s.status = 'completed'
        `, [req.user.business_id, today]);
        
        const yesterday = new Date(new Date(today) - 86400000).toISOString().split('T')[0];
        const prevDayResult = await pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) as prev_revenue
            FROM sales
            WHERE business_id = $1 AND sale_date = $2 AND status = 'completed'
        `, [req.user.business_id, yesterday]);
        
        const sales = salesResult.rows[0];
        const grossProfit = parseFloat(profitResult.rows[0].gross_profit) || 0;
        const totalExpenses = parseFloat(expenseResult.rows[0].total_expenses) || 0;
        const netProfit = grossProfit - totalExpenses;
        const prevRevenue = parseFloat(prevDayResult.rows[0].prev_revenue) || 0;
        const revenueGrowth = prevRevenue > 0 ? ((parseFloat(sales.total_revenue) - prevRevenue) / prevRevenue) * 100 : 0;
        
        res.json({
            date: today,
            total_sales: parseInt(sales.total_sales) || 0,
            total_revenue: parseFloat(sales.total_revenue) || 0,
            total_tax: parseFloat(sales.total_tax) || 0,
            unique_customers: parseInt(sales.unique_customers) || 0,
            active_days: parseInt(sales.active_days) || 1,
            total_discounts: parseFloat(sales.total_discounts) || 0,
            gross_profit: grossProfit,
            total_expenses: totalExpenses,
            net_profit: netProfit,
            revenue_growth: revenueGrowth,
            cash_sales: parseFloat(paymentResult.rows[0].cash_sales) || 0,
            electronic_sales: parseFloat(paymentResult.rows[0].electronic_sales) || 0,
            credit_sales: parseFloat(paymentResult.rows[0].credit_sales) || 0,
            other_sales: parseFloat(paymentResult.rows[0].other_sales) || 0
        });
        
    } catch (error) { 
        console.error('Daily report error:', error);
        res.status(500).json({ 
            error: error.message,
            total_sales: 0, total_revenue: 0, total_tax: 0, gross_profit: 0, 
            unique_customers: 0, net_profit: 0, total_expenses: 0,
            cash_sales: 0, electronic_sales: 0, credit_sales: 0, other_sales: 0, revenue_growth: 0
        });
    }
});

app.get('/api/reports/monthly', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { month, year } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        
        let prevMonth = targetMonth - 1;
        let prevYear = targetYear;
        if (prevMonth === 0) { prevMonth = 12; prevYear = targetYear - 1; }
        
        const salesResult = await pool.query(`
            SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(s.total_amount), 0) as total_revenue,
                COALESCE(SUM(s.tax_amount), 0) as total_tax,
                COALESCE(SUM(s.discount_amount), 0) as total_discounts,
                COUNT(DISTINCT s.customer_id) as unique_customers,
                COUNT(DISTINCT s.sale_date) as active_days
            FROM sales s
            WHERE s.business_id = $1 
            AND EXTRACT(MONTH FROM s.sale_date) = $2 
            AND EXTRACT(YEAR FROM s.sale_date) = $3
            AND s.status = 'completed'
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const profitResult = await pool.query(`
            SELECT COALESCE(SUM(
                (si.unit_price - COALESCE(p.cost_price, 0)) * si.quantity
            ), 0) as gross_profit
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN products p ON si.product_id = p.id
            WHERE s.business_id = $1 
            AND EXTRACT(MONTH FROM s.sale_date) = $2 
            AND EXTRACT(YEAR FROM s.sale_date) = $3
            AND s.status = 'completed'
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const expenseResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses
            FROM expenses
            WHERE business_id = $1 
            AND EXTRACT(MONTH FROM expense_date) = $2 
            AND EXTRACT(YEAR FROM expense_date) = $3
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const paymentResult = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN LOWER(s.payment_method) = 'cash' THEN s.total_amount ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN LOWER(s.payment_method) IN ('telebirr', 'cbe_birr', 'cbe', 'bank_transfer', 'digital') THEN s.total_amount ELSE 0 END), 0) as electronic_sales,
                COALESCE(SUM(CASE WHEN LOWER(s.payment_status) = 'credit' THEN s.total_amount ELSE 0 END), 0) as credit_sales
            FROM sales s
            WHERE s.business_id = $1 
            AND EXTRACT(MONTH FROM s.sale_date) = $2 
            AND EXTRACT(YEAR FROM s.sale_date) = $3
            AND s.status = 'completed'
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const prevMonthResult = await pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) as prev_revenue
            FROM sales
            WHERE business_id = $1 
            AND EXTRACT(MONTH FROM sale_date) = $2 
            AND EXTRACT(YEAR FROM sale_date) = $3
            AND status = 'completed'
        `, [req.user.business_id, prevMonth, prevYear]);
        
        const sales = salesResult.rows[0];
        const grossProfit = parseFloat(profitResult.rows[0].gross_profit) || 0;
        const totalExpenses = parseFloat(expenseResult.rows[0].total_expenses) || 0;
        const netProfit = grossProfit - totalExpenses;
        const prevRevenue = parseFloat(prevMonthResult.rows[0].prev_revenue) || 0;
        const revenueGrowth = prevRevenue > 0 ? ((parseFloat(sales.total_revenue) - prevRevenue) / prevRevenue) * 100 : 0;
        
        res.json({
            period: 'monthly', month: parseInt(targetMonth), year: parseInt(targetYear),
            total_sales: parseInt(sales.total_sales) || 0,
            total_revenue: parseFloat(sales.total_revenue) || 0,
            total_tax: parseFloat(sales.total_tax) || 0,
            total_discounts: parseFloat(sales.total_discounts) || 0,
            unique_customers: parseInt(sales.unique_customers) || 0,
            active_days: parseInt(sales.active_days) || 0,
            gross_profit: grossProfit, total_expenses: totalExpenses, net_profit: netProfit,
            revenue_growth: revenueGrowth,
            cash_sales: parseFloat(paymentResult.rows[0].cash_sales) || 0,
            electronic_sales: parseFloat(paymentResult.rows[0].electronic_sales) || 0,
            credit_sales: parseFloat(paymentResult.rows[0].credit_sales) || 0
        });
        
    } catch (error) { 
        console.error('Monthly report error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reports/summary', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = new Date().getMonth() + 1;
        const thisYear = new Date().getFullYear();
        
        const todayResult = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue 
            FROM sales WHERE business_id = $1 AND sale_date = $2 AND status = 'completed'
        `, [req.user.business_id, today]);
        
        const monthResult = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue 
            FROM sales WHERE business_id = $1 
            AND EXTRACT(MONTH FROM sale_date) = $2 AND EXTRACT(YEAR FROM sale_date) = $3 AND status = 'completed'
        `, [req.user.business_id, thisMonth, thisYear]);
        
        const totalResult = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue 
            FROM sales WHERE business_id = $1 AND status = 'completed'
        `, [req.user.business_id]);
        
        res.json({ 
            today: todayResult.rows[0],
            this_month: monthResult.rows[0],
            all_time: totalResult.rows[0] 
        });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// ============================================
// EXPENSES
// ============================================
app.get('/api/expenses', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM expenses WHERE business_id = $1 ORDER BY expense_date DESC LIMIT 50',
            [req.user.business_id]
        );
        res.json({ expenses: result.rows });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/expenses', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { category, amount, description, expense_date, receipt_image } = req.body;
        if (!category || !amount) return res.status(400).json({ error: 'Category and amount required' });
        
        const result = await pool.query(
            `INSERT INTO expenses (business_id, user_id, category, amount, description, expense_date, receipt_image) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [req.user.business_id, req.user.id, category, amount, description, expense_date || new Date().toISOString().split('T')[0], receipt_image || null]
        );
        res.status(201).json({ success: true, expense_id: result.rows[0].id });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.put('/api/expenses/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const { category, amount, description } = req.body;
        const result = await pool.query(
            'UPDATE expenses SET category = COALESCE($1, category), amount = COALESCE($2, amount), description = COALESCE($3, description), updated_at = NOW() WHERE id = $4 AND business_id = $5 RETURNING *',
            [category, amount, description, id, req.user.business_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ success: true, expense: result.rows[0], message: 'Expense updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/expenses/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM expenses WHERE id = $1 AND business_id = $2 RETURNING id', [id, req.user.business_id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ success: true, message: 'Expense deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// INVENTORY
// ============================================
app.post('/api/inventory/adjust', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { product_id, adjustment_type, quantity, direction, reason } = req.body;
        if (!product_id || !quantity || !direction) return res.status(400).json({ error: 'Product, quantity, and direction required' });
        
        const product = await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2', [product_id, req.user.business_id]);
        if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
        
        const newStock = direction === 'in' ? product.rows[0].current_stock + parseInt(quantity) : product.rows[0].current_stock - parseInt(quantity);
        if (newStock < 0) return res.status(400).json({ error: 'Insufficient stock' });
        
        await pool.query('UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2', [newStock, product_id]);
        await pool.query(
            `INSERT INTO stock_adjustments (business_id, product_id, user_id, adjustment_type, quantity, direction, reason) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [req.user.business_id, product_id, req.user.id, adjustment_type || 'correction', quantity, direction, reason]
        );
        
        await pool.query(
            `INSERT INTO stock_transactions (business_id, product_id, user_id, transaction_type, quantity, notes)
             VALUES ($1, $2, $3, 'adjustment', $4, $5)`,
            [req.user.business_id, product_id, req.user.id, direction === 'in' ? quantity : -quantity, reason || 'Stock adjustment']
        );
        
        res.json({ success: true, message: `Stock ${direction === 'in' ? 'increased' : 'decreased'} by ${quantity}`, new_stock: newStock });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// ============================================
// CASH-OUT (Z-REPORT) ENDPOINTS
// ============================================
app.get('/api/cashout/status', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await pool.query(
            'SELECT * FROM daily_cashouts WHERE business_id = $1 AND cashout_date = $2',
            [req.user.business_id, today]
        );
        
        const isClosed = result.rows.length > 0 && result.rows[0].is_closed === true;
        res.json({ is_closed: isClosed, cashout: result.rows[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cashout/summary', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const salesResult = await pool.query(`
            SELECT 
                COUNT(*) as total_transactions,
                COALESCE(SUM(total_amount), 0) as total_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN total_amount ELSE 0 END), 0) as credit_sales,
                COALESCE(SUM(CASE WHEN payment_method IN ('telebirr', 'cbe_birr', 'bank_transfer') THEN total_amount ELSE 0 END), 0) as electronic_sales,
                COALESCE(SUM(tax_amount), 0) as total_tax
            FROM sales 
            WHERE business_id = $1 AND sale_date = $2 AND status = 'completed'
        `, [req.user.business_id, today]);
        
        const expensesResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses
            FROM expenses 
            WHERE business_id = $1 AND expense_date = $2
        `, [req.user.business_id, today]);
        
        const prevDay = new Date();
        prevDay.setDate(prevDay.getDate() - 1);
        const prevDayStr = prevDay.toISOString().split('T')[0];
        
        const prevCashout = await pool.query(
            'SELECT actual_cash_balance FROM daily_cashouts WHERE business_id = $1 AND cashout_date = $2 AND is_closed = true',
            [req.user.business_id, prevDayStr]
        );
        
        const openingBalance = prevCashout.rows.length > 0 ? parseFloat(prevCashout.rows[0].actual_cash_balance) : 0;
        const expectedCashBalance = openingBalance + parseFloat(salesResult.rows[0].cash_sales) - parseFloat(expensesResult.rows[0].total_expenses);
        
        res.json({ 
            summary: {
                ...salesResult.rows[0],
                total_expenses: parseFloat(expensesResult.rows[0].total_expenses),
                opening_cash_balance: openingBalance,
                expected_cash_balance: expectedCashBalance
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/z-report/close', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { actual_cash_balance, notes } = req.body;
        const today = new Date().toISOString().split('T')[0];
        
        const prevDay = new Date();
        prevDay.setDate(prevDay.getDate() - 1);
        const prevDayStr = prevDay.toISOString().split('T')[0];
        
        const prevCashout = await client.query(
            'SELECT actual_cash_balance FROM daily_cashouts WHERE business_id = $1 AND cashout_date = $2 AND is_closed = true',
            [req.user.business_id, prevDayStr]
        );
        
        const openingBalance = prevCashout.rows.length > 0 ? parseFloat(prevCashout.rows[0].actual_cash_balance) : 0;
        
        const cashSales = await client.query(
            "SELECT COALESCE(SUM(total_amount), 0) as cash_total FROM sales WHERE business_id = $1 AND sale_date = $2 AND payment_method = 'cash' AND status = 'completed'",
            [req.user.business_id, today]
        );
        
        const cashExpenses = await client.query(
            "SELECT COALESCE(SUM(amount), 0) as expense_total FROM expenses WHERE business_id = $1 AND expense_date = $2 AND payment_method = 'cash'",
            [req.user.business_id, today]
        );
        
        const expectedCash = openingBalance + parseFloat(cashSales.rows[0].cash_total) - parseFloat(cashExpenses.rows[0].expense_total);
        const difference = actual_cash_balance - expectedCash;
        const status = difference === 0 ? 'exact' : (difference > 0 ? 'over' : 'short');
        
        const result = await client.query(
            `INSERT INTO daily_cashouts (
                business_id, user_id, cashout_date, opening_cash_balance, 
                cash_sales, cash_expenses, expected_cash_balance, 
                actual_cash_balance, cash_difference, status, notes, is_closed, closed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, NOW())
            ON CONFLICT (business_id, cashout_date) 
            DO UPDATE SET 
                actual_cash_balance = $8,
                cash_difference = $9,
                status = $10,
                notes = $11,
                is_closed = true,
                closed_at = NOW()
            RETURNING *`,
            [req.user.business_id, req.user.id, today, openingBalance, 
             cashSales.rows[0].cash_total, cashExpenses.rows[0].expense_total,
             expectedCash, actual_cash_balance, Math.abs(difference), status, notes]
        );
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, cashout: result.rows[0],
            message: status === 'short' 
                ? `⚠️ Cash Shortage: ${Math.abs(difference)} ETB. Please check your records.` 
                : status === 'over' 
                    ? `✅ Cash Over: ${difference} ETB extra. Verify for errors.` 
                    : '✅ Cash balanced perfectly! Z-Report closed.'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Z-Report error:', error);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
});

// ============================================
// USER MANAGEMENT
// ============================================
app.get('/api/users', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, full_name, phone, role, is_active, pin_code, created_at FROM users WHERE business_id = $1 ORDER BY created_at',
            [req.user.business_id]
        );
        res.json({ users: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/users', authenticate, authorize('owner'), async (req, res) => {
    try {
        const { full_name, phone, password, role, pin_code } = req.body;
        
        if (!full_name || !phone || !password || !role) {
            return res.status(400).json({ error: 'All fields required' });
        }
        if (!['owner', 'manager', 'cashier'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        
        const existing = await pool.query('SELECT id FROM users WHERE phone = $1 AND business_id = $2', [phone, req.user.business_id]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Phone number already exists' });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const result = await pool.query(
            'INSERT INTO users (business_id, full_name, phone, password_hash, role, pin_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [req.user.business_id, full_name, phone, hashedPassword, role, pin_code || null]
        );
        
        res.status(201).json({ success: true, user_id: result.rows[0].id });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/users/:id', authenticate, authorize('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, phone, role, pin_code, is_active } = req.body;
        
        const result = await pool.query(
            `UPDATE users SET 
                full_name = COALESCE($1, full_name),
                phone = COALESCE($2, phone),
                role = COALESCE($3, role),
                pin_code = COALESCE($4, pin_code),
                is_active = COALESCE($5, is_active),
                updated_at = NOW()
             WHERE id = $6 AND business_id = $7 RETURNING id`,
            [full_name, phone, role, pin_code, is_active, id, req.user.business_id]
        );
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/users/:id', authenticate, authorize('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
        
        const result = await pool.query(
            'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id',
            [id, req.user.business_id]
        );
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: 'User deactivated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// CASHIER PIN LOGIN
// ============================================
app.post('/api/auth/login-with-pin', async (req, res) => {
    try {
        const { pinCode } = req.body;
        
        if (!pinCode || pinCode.length < 4) {
            return res.status(400).json({ error: 'Valid PIN code required' });
        }
        
        const result = await pool.query(
            `SELECT u.*, b.name as business_name, b.is_active as biz_active 
             FROM users u JOIN businesses b ON u.business_id = b.id 
             WHERE u.pin_code = $1 AND u.is_active = true AND u.role = 'cashier'`,
            [pinCode]
        );
        
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid PIN code' });
        
        const user = result.rows[0];
        if (!user.biz_active) return res.status(403).json({ error: 'Business account deactivated' });
        
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        
        const token = jwt.sign(
            { id: user.id, business_id: user.business_id, role: user.role },
            JWT_SECRET, { expiresIn: '8h' }
        );
        
        res.json({ 
            success: true, token, 
            user: { id: user.id, name: user.full_name, business_name: user.business_name, role: user.role, is_cashier: true } 
        });
    } catch (error) {
        console.error('PIN login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/users/:id/set-pin', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const { pinCode } = req.body;
        
        if (!pinCode || pinCode.length < 4 || pinCode.length > 6) {
            return res.status(400).json({ error: 'PIN must be 4-6 digits' });
        }
        
        const user = await pool.query('SELECT role FROM users WHERE id = $1 AND business_id = $2', [id, req.user.business_id]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        if (user.rows[0].role !== 'cashier') return res.status(400).json({ error: 'PIN only available for cashiers' });
        
        await pool.query('UPDATE users SET pin_code = $1, updated_at = NOW() WHERE id = $2', [pinCode, id]);
        res.json({ success: true, message: 'PIN code set successfully' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// SMS & COMMUNICATION
// ============================================
app.post('/api/send-debt-reminder', authenticate, async (req, res) => {
    try {
        const { customerId, customerName, phone, amount, message } = req.body;
        console.log('===== SMS REMINDER =====');
        console.log(`To: ${phone} (${customerName}), Amount: ${amount} ETB`);
        res.json({ success: true, message: 'SMS sent successfully (Demo mode)' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// TELEGRAM BOT INTEGRATION
// ============================================
app.post('/api/telegram-webhook', async (req, res) => {
    console.log('📨 Webhook received');
    
    try {
        const { message, callback_query } = req.body;
        
        if (callback_query) {
            const chatId = callback_query.message.chat.id;
            const data = callback_query.data;
            
            await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: callback_query.id })
            });
            
            if (data === 'balance') {
                const customer = await pool.query(
                    'SELECT full_name, current_balance FROM customers WHERE telegram_chat_id = $1',
                    [chatId.toString()]
                );
                
                if (customer.rows.length > 0) {
                    await sendTelegramMessage(chatId, 
                        `💰 <b>Account Balance</b>\n\nDear ${customer.rows[0].full_name},\n\nYour current balance is: <code>${customer.rows[0].current_balance} ETB</code>`
                    );
                } else {
                    await sendTelegramMessage(chatId, '❌ <b>Account Not Found</b>\n\nPlease scan the QR code at the shop.');
                }
            }
            return res.sendStatus(200);
        }
        
        if (message && message.text) {
            const chatId = message.chat.id;
            const text = message.text;
            
            if (text.startsWith('/start')) {
                const parts = text.split(' ');
                let customerId = parts.length > 1 ? parts[1] : null;
                
                if (customerId) {
                    const customer = await pool.query(
                        'SELECT id, full_name, business_id, current_balance FROM customers WHERE id = $1', [customerId]
                    );
                    
                    if (customer.rows.length > 0) {
                        await pool.query('UPDATE customers SET telegram_chat_id = $1 WHERE id = $2', [chatId.toString(), customerId]);
                        await sendTelegramMessage(chatId, 
                            `🎉 <b>Welcome ${customer.rows[0].full_name}!</b>\n\n✅ Connected!\n<b>Balance:</b> ${customer.rows[0].current_balance} ETB\n\n/balance - Check balance\n/help - Help`
                        );
                        return res.sendStatus(200);
                    }
                }
                await sendTelegramMessage(chatId, '🤖 <b>Smart SME Manager Bot</b>\n\nWelcome! Type /help for commands.');
            }
            else if (text === '/balance') {
                const customer = await pool.query(
                    'SELECT full_name, current_balance FROM customers WHERE telegram_chat_id = $1', [chatId.toString()]
                );
                if (customer.rows.length > 0) {
                    await sendTelegramMessage(chatId, `💰 Balance: ${customer.rows[0].current_balance} ETB`);
                } else {
                    await sendTelegramMessage(chatId, '❌ Account not found.');
                }
            }
            else if (text === '/help') {
                await sendTelegramMessage(chatId, '📖 Commands:\n/start - Initialize\n/balance - Check balance\n/help - Help');
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(200);
    }
});

app.post('/api/register-telegram', authenticate, async (req, res) => {
    try {
        const { customerId, telegramChatId } = req.body;
        const customer = await pool.query('SELECT * FROM customers WHERE id = $1 AND business_id = $2', [customerId, req.user.business_id]);
        if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
        
        await pool.query('UPDATE customers SET telegram_chat_id = $1 WHERE id = $2', [telegramChatId, customerId]);
        
        await sendTelegramMessage(telegramChatId, 
            `🎉 <b>Welcome ${customer.rows[0].full_name}!</b>\n\n✅ Linked!\n<b>Balance:</b> ${customer.rows[0].current_balance} ETB`
        );
        
        res.json({ success: true, message: 'Telegram ID registered successfully' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/send-telegram-reminder', authenticate, async (req, res) => {
    try {
        const { customerId, customerName, phone, amount, message, telegramChatId } = req.body;
        
        if (!telegramChatId) {
            return res.status(400).json({ error: 'Customer has not registered Telegram' });
        }
        
        const amountNum = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
        
        const formattedMessage = `
🔔 <b>PAYMENT REMINDER</b>

Dear ${customerName},

${message}

<b>💰 Amount Due:</b> <code>${amountNum.toFixed(2)} ETB</code>

Please make your payment soon. Thank you! 🙏
        `;
        
        const result = await sendTelegramMessage(telegramChatId, formattedMessage);
        
        if (result && result.success) {
            await pool.query(
                `INSERT INTO action_logs (business_id, user_id, action_type, entity_type, entity_id, details)
                 VALUES ($1, $2, 'send_telegram', 'customer', $3, $4)`,
                [req.user.business_id, req.user.id, customerId, JSON.stringify({ amount: amountNum, status: 'sent' })]
            );
            return res.json({ success: true, message: 'Telegram reminder sent' });
        } else {
            return res.json({ success: false, error: result?.error || 'Failed to send' });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        return res.json({ success: false, error: error.message });
    }
});

// ============================================
// META WHATSAPP CLOUD API
// ============================================
app.post('/api/send-whatsapp-reminder', authenticate, async (req, res) => {
    try {
        const { customerId, customerName, phone, amount, message } = req.body;
        
        if (!phone) return res.status(400).json({ error: 'Phone required' });
        if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
            return res.status(500).json({ error: 'WhatsApp not configured', demo: true });
        }
        
        const personalizedMessage = message.replace(/{name}/g, customerName).replace(/{amount}/g, `${amount} ETB`);
        const result = await sendWhatsAppMessage(phone, personalizedMessage);
        
        await pool.query(
            `INSERT INTO action_logs (business_id, user_id, action_type, entity_type, entity_id, details)
             VALUES ($1, $2, 'send_whatsapp', 'customer', $3, $4)`,
            [req.user.business_id, req.user.id, customerId, JSON.stringify({ phone, amount, success: result.success })]
        );
        
        res.json({ success: result.success, message: result.success ? 'Sent' : 'Failed', error: result.error });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// SUBSCRIPTION PAYMENT WITH NOTIFICATION
// ============================================
app.post('/api/subscription/pay', authenticate, async (req, res) => {
    try {
        const { plan, amount, payment_method, transaction_ref } = req.body;
        const businessId = req.user.business_id;
        
        if (!plan || !amount) return res.status(400).json({ error: 'Plan and amount required' });
        
        const business = await pool.query('SELECT name, owner_name, phone FROM businesses WHERE id = $1', [businessId]);
        const bizName = business.rows[0]?.name || 'Unknown';
        const ownerName = business.rows[0]?.owner_name || 'Unknown';
        const ownerPhone = business.rows[0]?.phone || 'Unknown';
        
        const result = await pool.query(
            `INSERT INTO subscription_payments (business_id, plan, amount, payment_method, transaction_ref)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [businessId, plan, amount, payment_method || 'manual', transaction_ref]
        );
        
        await pool.query('UPDATE businesses SET payment_status = $1, updated_at = NOW() WHERE id = $2', ['pending', businessId]);
        
        // Create admin notification
        await pool.query(
            `INSERT INTO admin_notifications (type, title, message, business_id, reference_id, is_read)
             VALUES ($1, $2, $3, $4, $5, false)`,
            ['payment', 'New Payment', `${bizName} (${ownerName}) submitted ${amount} ETB for ${plan} plan via ${payment_method || 'manual'}. Ref: ${transaction_ref || 'N/A'}`, businessId, result.rows[0].id]
        );
        
        // Send Telegram to admin
        if (TELEGRAM_BOT_TOKEN && process.env.ADMIN_TELEGRAM_CHAT_ID) {
            await sendTelegramMessage(process.env.ADMIN_TELEGRAM_CHAT_ID, 
                `🔔 <b>New Payment!</b>\n\n<b>Business:</b> ${bizName}\n<b>Owner:</b> ${ownerName}\n<b>Phone:</b> ${ownerPhone}\n<b>Plan:</b> ${plan.toUpperCase()}\n<b>Amount:</b> ${amount} ETB\n<b>Method:</b> ${payment_method || 'manual'}\n<b>Ref:</b> ${transaction_ref || 'N/A'}\n\n<i>Verify in Admin Panel.</i>`
            );
        }
        
        res.status(201).json({ success: true, payment: result.rows[0], message: 'Payment submitted! Waiting for admin verification.' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Get my payments
app.get('/api/subscription/payments', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM subscription_payments WHERE business_id = $1 ORDER BY created_at DESC LIMIT 20',
            [req.user.business_id]
        );
        res.json({ payments: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Get my subscription status
app.get('/api/subscription/my-status', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT subscription_tier, payment_status, last_payment_date, next_payment_date,
                    (SELECT COALESCE(SUM(amount), 0) FROM subscription_payments WHERE business_id = $1 AND payment_status = 'verified') as total_paid
             FROM businesses WHERE id = $1`, [req.user.business_id]
        );
        
        const biz = result.rows[0];
        res.json({
            plan: biz.subscription_tier, payment_status: biz.payment_status,
            last_payment: biz.last_payment_date, next_payment: biz.next_payment_date,
            total_paid: parseFloat(biz.total_paid)
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// ADMIN NOTIFICATIONS
// ============================================
app.get('/api/admin/notifications', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM admin_notifications WHERE is_read = false ORDER BY created_at DESC LIMIT 20'
        );
        res.json({ notifications: result.rows, unread_count: result.rows.length });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/admin/notifications/:id/read', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        await pool.query('UPDATE admin_notifications SET is_read = true WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/admin/notifications/read-all', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        await pool.query('UPDATE admin_notifications SET is_read = true WHERE is_read = false');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// ADMIN PAYMENTS MANAGEMENT
// ============================================
app.get('/api/admin/payments', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT sp.*, b.name as business_name, b.owner_name, b.phone
            FROM subscription_payments sp
            JOIN businesses b ON sp.business_id = b.id
            WHERE 1=1
        `;
        const params = [];
        
        if (status) { params.push(status); query += ` AND sp.payment_status = $${params.length}`; }
        query += ` ORDER BY sp.created_at DESC LIMIT 50`;
        
        const result = await pool.query(query, params);
        res.json({ payments: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/admin/payments/:id/verify', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const payment = await pool.query('SELECT * FROM subscription_payments WHERE id = $1', [id]);
        if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        
        const p = payment.rows[0];
        
        await pool.query(
            'UPDATE subscription_payments SET payment_status = $1, verified_by = $2, verified_at = NOW() WHERE id = $3',
            [status, req.user.id, id]
        );
        
        if (status === 'verified') {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 30);
            
            await pool.query(
                `UPDATE businesses SET subscription_tier = $1, payment_status = 'paid',
                 last_payment_date = CURRENT_DATE, next_payment_date = $2, updated_at = NOW()
                 WHERE id = $3`,
                [p.plan, nextDate.toISOString().split('T')[0], p.business_id]
            );
            
            // Notify business owner via Telegram
            const business = await pool.query('SELECT phone FROM businesses WHERE id = $1', [p.business_id]);
            if (business.rows[0]?.phone && TELEGRAM_BOT_TOKEN) {
                const customer = await pool.query('SELECT telegram_chat_id FROM customers WHERE phone = $1 LIMIT 1', [business.rows[0].phone]);
                if (customer.rows[0]?.telegram_chat_id) {
                    await sendTelegramMessage(customer.rows[0].telegram_chat_id, 
                        `✅ <b>Payment Verified!</b>\n\nYour ${p.plan.toUpperCase()} plan is activated.\nAmount: ${p.amount} ETB\nValid until: ${nextDate.toISOString().split('T')[0]}`
                    );
                }
            }
        }
        
        res.json({ success: true, message: `Payment ${status}` });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// PAYMENT METHODS
// ============================================
app.get('/api/payment-methods', authenticate, async (req, res) => {
    res.json({
        methods: [
            { name: 'Telebirr', account: '0945305180', instructions: 'Send to Telebirr: 0945305180 (Kassie Taye)' },
            { name: 'CBE Birr', account: '0945305180', instructions: 'Dial *847# → Send Money → 0945305180' },
            { name: 'Bank Transfer', bank: 'Commercial Bank of Ethiopia', account_number: '1000234567890', account_name: 'Kassie Taye', instructions: 'Transfer and submit reference' },
            { name: 'Cash', instructions: 'Pay in person at our office' }
        ]
    });
});

// ============================================
// CLIENT MANAGEMENT
// ============================================
app.get('/api/admin/clients', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
        res.json({ clients: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/clients', authenticate, async (req, res) => {
    try {
        const { business_name, owner_name, phone, email, city, subscription_plan, monthly_fee } = req.body;
        if (!business_name || !owner_name || !phone) return res.status(400).json({ error: 'Business name, owner, and phone required' });
        
        const result = await pool.query(
            `INSERT INTO clients (business_name, owner_name, phone, email, city, subscription_plan, monthly_fee, subscription_start)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE) RETURNING *`,
            [business_name, owner_name, phone, email || null, city || null, subscription_plan || 'trial', monthly_fee || 0]
        );
        res.status(201).json({ success: true, client: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'Phone already registered' });
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/clients/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { business_name, owner_name, phone, email, city, subscription_plan, monthly_fee, is_active, notes, payment_status } = req.body;
        
        const result = await pool.query(
            `UPDATE clients SET 
                business_name = COALESCE($1, business_name), owner_name = COALESCE($2, owner_name),
                phone = COALESCE($3, phone), email = COALESCE($4, email), city = COALESCE($5, city),
                subscription_plan = COALESCE($6, subscription_plan), monthly_fee = COALESCE($7, monthly_fee),
                is_active = COALESCE($8, is_active), notes = COALESCE($9, notes),
                payment_status = COALESCE($10, payment_status), updated_at = NOW()
             WHERE id = $11 RETURNING *`,
            [business_name, owner_name, phone, email, city, subscription_plan, monthly_fee, is_active, notes, payment_status, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, client: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/clients/:id/payment', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, payment_method } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
        
        await pool.query('UPDATE clients SET total_paid = total_paid + $1, payment_status = $2, updated_at = NOW() WHERE id = $3', [amount, 'paid', id]);
        await pool.query('INSERT INTO client_payments (client_id, amount, payment_method, recorded_by) VALUES ($1, $2, $3, $4)', [id, amount, payment_method || 'cash', req.user.id]);
        
        res.json({ success: true, message: 'Payment recorded' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// DASHBOARD
// ============================================
app.get('/api/admin/dashboard', authenticate, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM clients WHERE is_active = true) as total_clients,
                (SELECT COUNT(*) FROM clients WHERE created_at > NOW() - INTERVAL '30 days') as new_this_month,
                (SELECT COALESCE(SUM(monthly_fee), 0) FROM clients WHERE is_active = true AND payment_status = 'paid') as mrr,
                (SELECT COUNT(*) FROM clients WHERE payment_status = 'pending') as pending_payments,
                (SELECT COALESCE(SUM(amount), 0) FROM client_payments WHERE payment_date > NOW() - INTERVAL '30 days') as collected_this_month,
                (SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','in_progress')) as open_tickets
        `);
        res.json(stats.rows[0] || { total_clients: 0, new_this_month: 0, mrr: 0, pending_payments: 0, collected_this_month: 0, open_tickets: 0 });
    } catch (error) { res.json({ total_clients: 0, new_this_month: 0, mrr: 0, pending_payments: 0, collected_this_month: 0, open_tickets: 0 }); }
});

// ============================================
// APP VERSION & ANNOUNCEMENTS
// ============================================
app.get('/api/app-version', async (req, res) => {
    res.json({ latest_version: '1.0.0', download_url: 'https://your-server.com/SmartSME.apk', update_required: false });
});

app.get('/api/announcements', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT message FROM announcements WHERE (business_id = $1 OR business_id IS NULL) AND is_active = true ORDER BY created_at DESC LIMIT 1`,
            [req.user.business_id]
        );
        res.json(result.rows[0] || { message: null });
    } catch (error) { res.json({ message: null }); }
});

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 API URL: ${process.env.API_URL || 'https://smart-sme-api.onrender.com'}`);
    console.log(`📅 Ethiopian Calendar Support: Enabled`);
    console.log(`💰 Tax System: Optional (VAT/TOT/None)`);
    console.log(`🔔 Payment Notifications: Enabled`);
    console.log(`\n📋 Available Routes:`);
    console.log(`  POST /api/auth/register`);
    console.log(`  POST /api/auth/login`);
    console.log(`  POST /api/auth/login-with-pin`);
    console.log(`  GET/POST /api/products`);
    console.log(`  GET/POST /api/customers`);
    console.log(`  POST /api/sales`);
    console.log(`  GET /api/reports/daily`);
    console.log(`  POST /api/subscription/pay`);
    console.log(`  GET /api/admin/notifications`);
    console.log(`  GET /api/admin/payments`);
    console.log(`  POST /api/z-report/close`);
    console.log(`  POST /api/telegram-webhook`);
});

module.exports = app;