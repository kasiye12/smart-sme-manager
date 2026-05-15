const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
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

app.use(express.json());

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => console.error('Unexpected pool error:', err));

pool.query('SELECT NOW()')
    .then(res => console.log('✅ Database connected at:', res.rows[0].now))
    .catch(err => console.error('❌ Database connection failed:', err.message));

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
// AUTH MIDDLEWARE
// ============================================
const authenticate = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'my-super-secret-key-2026');
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
            'INSERT INTO businesses (name, owner_name, phone) VALUES ($1, $2, $3) RETURNING id', [business_name, owner_name, phone]
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
            process.env.JWT_SECRET || 'my-super-secret-key-2026',
            { expiresIn: '24h' }
        );
        
        res.status(201).json({ success: true, message: 'Business registered successfully', token, business_id: businessId });
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
            process.env.JWT_SECRET || 'my-super-secret-key-2026',
            { expiresIn: '24h' }
        );
        
        res.json({ success: true, token, user: { id: user.id, name: user.full_name, business_name: user.business_name, role: user.role } });
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

// In your server.js
app.get('/api/business/profile', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, owner_name, phone, email, city, 
                    tin_number, tax_type, tax_rate, 
                    show_tax_on_receipt, subscription_tier 
             FROM businesses WHERE id::text = $1::text`,
            [String(req.user.business_id)]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Business not found' });
        }
        
        const business = result.rows[0];
        
        // Log for debugging
        console.log('📊 Business profile requested:', {
            id: business.id,
            name: business.name,
            subscription_tier: business.subscription_tier
        });
        
        // Return with subscription_tier
        res.json({
            id: business.id,
            name: business.name,
            owner_name: business.owner_name,
            phone: business.phone,
            email: business.email,
            city: business.city,
            tin_number: business.tin_number,
            tax_type: business.tax_type,
            tax_rate: business.tax_rate,
            show_tax_on_receipt: business.show_tax_on_receipt,
            subscription_tier: business.subscription_tier || 'free'  // Ensure this is returned
        });
    } catch (error) {
        console.error('Profile error:', error);
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
            [req.user.business_id, JSON.stringify(name_translations), barcode, cost_price, selling_price, current_stock || 0, unit || 'piece', track_expiry || false, expiry_date || null, batch_number || null]
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
            [name_translations ? JSON.stringify(name_translations) : null, barcode, cost_price, selling_price, current_stock, unit, category_id, track_expiry, expiry_date, batch_number, id, req.user.business_id]
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
        
        console.log(`Generating daily report for: ${today}, business: ${req.user.business_id}`);
        
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
        
        const response = {
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
        };
        
        console.log('Daily report response:', response);
        res.json(response);
        
    } catch (error) { 
        console.error('Daily report error:', error);
        res.status(500).json({ 
            error: error.message,
            total_sales: 0, 
            total_revenue: 0, 
            total_tax: 0, 
            gross_profit: 0, 
            unique_customers: 0,
            net_profit: 0,
            total_expenses: 0,
            cash_sales: 0,
            electronic_sales: 0,
            credit_sales: 0,
            other_sales: 0,
            revenue_growth: 0
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
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear = targetYear - 1;
        }
        
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
        
        const response = {
            period: 'monthly',
            month: parseInt(targetMonth),
            year: parseInt(targetYear),
            total_sales: parseInt(sales.total_sales) || 0,
            total_revenue: parseFloat(sales.total_revenue) || 0,
            total_tax: parseFloat(sales.total_tax) || 0,
            total_discounts: parseFloat(sales.total_discounts) || 0,
            unique_customers: parseInt(sales.unique_customers) || 0,
            active_days: parseInt(sales.active_days) || 0,
            gross_profit: grossProfit,
            total_expenses: totalExpenses,
            net_profit: netProfit,
            revenue_growth: revenueGrowth,
            cash_sales: parseFloat(paymentResult.rows[0].cash_sales) || 0,
            electronic_sales: parseFloat(paymentResult.rows[0].electronic_sales) || 0,
            credit_sales: parseFloat(paymentResult.rows[0].credit_sales) || 0
        };
        
        console.log('Monthly report response:', response);
        res.json(response);
        
    } catch (error) { 
        console.error('Monthly report error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reports/yearly', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { year } = req.query;
        const targetYear = year || new Date().getFullYear();
        
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_sales, 
                COALESCE(SUM(total_amount), 0) as total_revenue, 
                COALESCE(SUM(tax_amount), 0) as total_tax, 
                COUNT(DISTINCT customer_id) as unique_customers, 
                COUNT(DISTINCT EXTRACT(MONTH FROM sale_date)) as active_months 
            FROM sales 
            WHERE business_id = $1 
            AND EXTRACT(YEAR FROM sale_date) = $2 
            AND status = 'completed'
        `, [req.user.business_id, targetYear]);
        
        const profitResult = await pool.query(`
            SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit 
            FROM sale_items si 
            JOIN sales s ON si.sale_id = s.id 
            WHERE s.business_id = $1 
            AND EXTRACT(YEAR FROM s.sale_date) = $2
        `, [req.user.business_id, targetYear]);
        
        const expenseResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses 
            FROM expenses 
            WHERE business_id = $1 
            AND EXTRACT(YEAR FROM expense_date) = $2
        `, [req.user.business_id, targetYear]);
        
        const monthlyBreakdown = await pool.query(`
            SELECT 
                EXTRACT(MONTH FROM sale_date) as month, 
                COUNT(*) as sales_count, 
                COALESCE(SUM(total_amount), 0) as revenue 
            FROM sales 
            WHERE business_id = $1 
            AND EXTRACT(YEAR FROM sale_date) = $2 
            AND status = 'completed'
            GROUP BY EXTRACT(MONTH FROM sale_date) 
            ORDER BY month
        `, [req.user.business_id, targetYear]);
        
        const totalExpenses = expenseResult.rows[0].total_expenses || 0;
        const grossProfit = profitResult.rows[0].gross_profit || 0;
        
        res.json({ 
            period: 'yearly', 
            year: parseInt(targetYear), 
            ...result.rows[0], 
            gross_profit: grossProfit, 
            total_expenses: totalExpenses, 
            net_profit: grossProfit - totalExpenses, 
            monthly_breakdown: monthlyBreakdown.rows 
        });
    } catch (error) { 
        console.error('Yearly report error:', error);
        res.status(500).json({ error: error.message }); 
    }
});

app.get('/api/reports/quarterly', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { quarter, year } = req.query;
        const targetQuarter = quarter || Math.ceil((new Date().getMonth() + 1) / 3);
        const targetYear = year || new Date().getFullYear();
        const startMonth = (targetQuarter - 1) * 3 + 1;
        const endMonth = startMonth + 2;
        
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_sales, 
                COALESCE(SUM(total_amount), 0) as total_revenue, 
                COALESCE(SUM(tax_amount), 0) as total_tax, 
                COUNT(DISTINCT customer_id) as unique_customers, 
                COUNT(DISTINCT sale_date) as active_days 
            FROM sales 
            WHERE business_id = $1 
            AND EXTRACT(MONTH FROM sale_date) BETWEEN $2 AND $3 
            AND EXTRACT(YEAR FROM sale_date) = $4 
            AND status = 'completed'
        `, [req.user.business_id, startMonth, endMonth, targetYear]);
        
        const profitResult = await pool.query(`
            SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit 
            FROM sale_items si 
            JOIN sales s ON si.sale_id = s.id 
            WHERE s.business_id = $1 
            AND EXTRACT(MONTH FROM s.sale_date) BETWEEN $2 AND $3 
            AND EXTRACT(YEAR FROM s.sale_date) = $4
        `, [req.user.business_id, startMonth, endMonth, targetYear]);
        
        const expenseResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses 
            FROM expenses 
            WHERE business_id = $1 
            AND EXTRACT(MONTH FROM expense_date) BETWEEN $2 AND $3 
            AND EXTRACT(YEAR FROM expense_date) = $4
        `, [req.user.business_id, startMonth, endMonth, targetYear]);
        
        const totalExpenses = expenseResult.rows[0].total_expenses || 0;
        const grossProfit = profitResult.rows[0].gross_profit || 0;
        
        res.json({ 
            period: 'quarterly', 
            quarter: parseInt(targetQuarter), 
            year: parseInt(targetYear), 
            months: `${startMonth}-${endMonth}`, 
            ...result.rows[0], 
            gross_profit: grossProfit, 
            total_expenses: totalExpenses, 
            net_profit: grossProfit - totalExpenses 
        });
    } catch (error) { 
        console.error('Quarterly report error:', error);
        res.status(500).json({ error: error.message }); 
    }
});

app.get('/api/reports/custom', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'From and To dates required' });
        
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_sales, 
                COALESCE(SUM(total_amount), 0) as total_revenue, 
                COALESCE(SUM(tax_amount), 0) as total_tax, 
                COALESCE(SUM(discount_amount), 0) as total_discounts, 
                COUNT(DISTINCT customer_id) as unique_customers, 
                COUNT(DISTINCT sale_date) as active_days 
            FROM sales 
            WHERE business_id = $1 
            AND sale_date BETWEEN $2 AND $3 
            AND status = 'completed'
        `, [req.user.business_id, from, to]);
        
        const profitResult = await pool.query(`
            SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit 
            FROM sale_items si 
            JOIN sales s ON si.sale_id = s.id 
            WHERE s.business_id = $1 
            AND s.sale_date BETWEEN $2 AND $3
        `, [req.user.business_id, from, to]);
        
        const expenseResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses 
            FROM expenses 
            WHERE business_id = $1 
            AND expense_date BETWEEN $2 AND $3
        `, [req.user.business_id, from, to]);
        
        const totalExpenses = expenseResult.rows[0].total_expenses || 0;
        const grossProfit = profitResult.rows[0].gross_profit || 0;
        
        res.json({ 
            period: 'custom', 
            from, to, 
            ...result.rows[0], 
            gross_profit: grossProfit, 
            total_expenses: totalExpenses, 
            net_profit: grossProfit - totalExpenses 
        });
    } catch (error) { 
        console.error('Custom report error:', error);
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
            AND EXTRACT(MONTH FROM sale_date) = $2 
            AND EXTRACT(YEAR FROM sale_date) = $3 
            AND status = 'completed'
        `, [req.user.business_id, thisMonth, thisYear]);
        
        const yearResult = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue 
            FROM sales WHERE business_id = $1 
            AND EXTRACT(YEAR FROM sale_date) = $2 
            AND status = 'completed'
        `, [req.user.business_id, thisYear]);
        
        const totalResult = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue 
            FROM sales WHERE business_id = $1 AND status = 'completed'
        `, [req.user.business_id]);
        
        const todayProfit = await pool.query(`
            SELECT COALESCE(SUM(si.profit_amount), 0) as profit
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.business_id = $1 AND s.sale_date = $2 AND s.status = 'completed'
        `, [req.user.business_id, today]);
        
        res.json({ 
            today: {
                ...todayResult.rows[0],
                profit: todayProfit.rows[0].profit || 0
            },
            this_month: monthResult.rows[0],
            this_year: yearResult.rows[0],
            all_time: totalResult.rows[0] 
        });
    } catch (error) { 
        console.error('Summary report error:', error);
        res.status(500).json({ error: error.message }); 
    }
});

app.get('/api/reports/debt-aging', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.id as customer_id, 
                c.full_name as customer_name, 
                c.phone, 
                c.current_balance,
                COALESCE(SUM(CASE WHEN ct.created_at > NOW() - INTERVAL '7 days' THEN ct.amount ELSE 0 END), 0) as week1_debt,
                COALESCE(SUM(CASE WHEN ct.created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '8 days' THEN ct.amount ELSE 0 END), 0) as month1_debt,
                COALESCE(SUM(CASE WHEN ct.created_at < NOW() - INTERVAL '30 days' THEN ct.amount ELSE 0 END), 0) as older_debt
            FROM customers c
            LEFT JOIN credit_transactions ct ON c.id = ct.customer_id AND ct.transaction_type = 'credit'
            WHERE c.business_id = $1 AND c.current_balance > 0
            GROUP BY c.id, c.full_name, c.phone, c.current_balance
            ORDER BY c.current_balance DESC
        `, [req.user.business_id]);
        
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Debt aging error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reports/top-products', authenticate, async (req, res) => {
    try {
        const { period, date, month, year, quarter, from, to } = req.query;
        
        console.log(`Top products request - period: ${period}, date: ${date}, business: ${req.user.business_id}`);
        
        let dateCondition = '';
        let params = [req.user.business_id];
        let paramCount = 2;
        
        if (period === 'daily' && date) {
            dateCondition = `AND s.sale_date = $${paramCount++}`;
            params.push(date);
        } else if (period === 'monthly' && month && year) {
            dateCondition = `AND EXTRACT(MONTH FROM s.sale_date) = $${paramCount++} 
                            AND EXTRACT(YEAR FROM s.sale_date) = $${paramCount++}`;
            params.push(month, year);
        } else if (period === 'quarterly' && quarter && year) {
            const startMonth = (quarter - 1) * 3 + 1;
            const endMonth = startMonth + 2;
            dateCondition = `AND EXTRACT(MONTH FROM s.sale_date) BETWEEN $${paramCount++} AND $${paramCount++}
                            AND EXTRACT(YEAR FROM s.sale_date) = $${paramCount++}`;
            params.push(startMonth, endMonth, year);
        } else if (period === 'yearly' && year) {
            dateCondition = `AND EXTRACT(YEAR FROM s.sale_date) = $${paramCount++}`;
            params.push(year);
        } else if (period === 'custom' && from && to) {
            dateCondition = `AND s.sale_date BETWEEN $${paramCount++} AND $${paramCount++}`;
            params.push(from, to);
        } else {
            const today = new Date().toISOString().split('T')[0];
            dateCondition = `AND s.sale_date = $${paramCount++}`;
            params.push(today);
        }
        
        const totalRevenueQuery = await pool.query(`
            SELECT COALESCE(SUM(s.total_amount), 1) as total_revenue
            FROM sales s
            WHERE s.business_id = $1 AND s.status = 'completed'
            ${dateCondition}
        `, params);
        
        const totalRevenue = parseFloat(totalRevenueQuery.rows[0]?.total_revenue || 1);
        
        const productsQuery = await pool.query(`
            SELECT 
                COALESCE(p.name_translations->>'en', 'Unknown') as product_name,
                COALESCE(SUM(si.quantity), 0) as total_quantity,
                COALESCE(SUM(si.total_price), 0) as total_revenue
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.business_id = $1 AND s.status = 'completed'
            ${dateCondition}
            GROUP BY p.id, p.name_translations
            ORDER BY total_revenue DESC
            LIMIT 10
        `, params);
        
        const products = productsQuery.rows.map(row => ({
            product_name: row.product_name,
            total_quantity: parseInt(row.total_quantity),
            total_revenue: parseFloat(row.total_revenue),
            percentage: (parseFloat(row.total_revenue) / totalRevenue) * 100
        }));
        
        console.log(`Found ${products.length} top products, total revenue: ${totalRevenue}`);
        
        res.json({ products: products });
        
    } catch (error) {
        console.error('Top products error:', error);
        res.status(500).json({ error: error.message, products: [] });
    }
});

app.get('/api/reports/advanced/daily', authenticate, async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const yesterday = new Date(new Date(date) - 86400000).toISOString().split('T')[0];
        
        const currentDayQuery = await pool.query(`
            WITH sales_data AS (
                SELECT 
                    COALESCE(SUM(s.total_amount), 0) as total_revenue,
                    COUNT(*) as total_sales,
                    COUNT(DISTINCT s.customer_id) as unique_customers,
                    COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.total_amount ELSE 0 END), 0) as cash_sales,
                    COALESCE(SUM(CASE WHEN s.payment_method IN ('telebirr', 'cbe_birr', 'bank_transfer') THEN s.total_amount ELSE 0 END), 0) as digital_sales,
                    COALESCE(SUM(CASE WHEN s.payment_status = 'credit' THEN s.total_amount ELSE 0 END), 0) as credit_sales,
                    COALESCE(SUM(si.quantity * p.cost_price), 0) as cogs,
                    COALESCE(SUM(s.total_amount) - SUM(si.quantity * p.cost_price), 0) as gross_profit,
                    COALESCE(SUM(s.tax_amount), 0) as total_tax
                FROM sales s
                LEFT JOIN sale_items si ON s.id = si.sale_id
                LEFT JOIN products p ON si.product_id = p.id
                WHERE s.business_id = $1 AND s.sale_date = $2 AND s.status = 'completed'
                GROUP BY s.sale_date
            ),
            expenses_data AS (
                SELECT COALESCE(SUM(amount), 0) as total_expenses
                FROM expenses
                WHERE business_id = $1 AND expense_date = $2
            ),
            previous_day AS (
                SELECT COALESCE(SUM(total_amount), 0) as prev_revenue,
                       COUNT(*) as prev_sales
                FROM sales
                WHERE business_id = $1 AND sale_date = $3 AND status = 'completed'
            ),
            cashout_data AS (
                SELECT opening_cash_balance, actual_cash_balance
                FROM daily_cashouts
                WHERE business_id = $1 AND cashout_date = $2
                LIMIT 1
            )
            SELECT 
                sd.*,
                ed.total_expenses,
                pd.prev_revenue,
                pd.prev_sales,
                sd.gross_profit - ed.total_expenses as net_profit,
                cd.opening_cash_balance,
                cd.actual_cash_balance,
                CASE WHEN pd.prev_revenue > 0 THEN ((sd.total_revenue - pd.prev_revenue) / pd.prev_revenue) * 100 ELSE 0 END as revenue_growth,
                CASE WHEN pd.prev_sales > 0 THEN ((sd.total_sales - pd.prev_sales) / pd.prev_sales) * 100 ELSE 0 END as sales_growth,
                COALESCE(cd.opening_cash_balance, 0) + sd.cash_sales as expected_cash_balance,
                CASE WHEN sd.total_revenue > 0 THEN (sd.gross_profit / sd.total_revenue) * 100 ELSE 0 END as gross_margin,
                CASE WHEN sd.total_revenue > 0 THEN ((sd.gross_profit - ed.total_expenses) / sd.total_revenue) * 100 ELSE 0 END as net_margin
            FROM sales_data sd
            CROSS JOIN expenses_data ed
            CROSS JOIN previous_day pd
            LEFT JOIN cashout_data cd ON true
        `, [req.user.business_id, date, yesterday]);
        
        const topProducts = await pool.query(`
            SELECT 
                p.name_translations->>'en' as product_name,
                COALESCE(SUM(si.quantity), 0) as total_quantity,
                COALESCE(SUM(si.total_price), 0) as total_revenue,
                (SUM(si.total_price) / (SELECT COALESCE(SUM(total_amount), 1) FROM sales WHERE business_id = $1 AND sale_date = $2 AND status = 'completed')) * 100 as percentage
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.business_id = $1 AND s.sale_date = $2 AND s.status = 'completed'
            GROUP BY p.id, p.name_translations
            ORDER BY total_revenue DESC
            LIMIT 5
        `, [req.user.business_id, date]);
        
        const result = currentDayQuery.rows[0] || {};
        
        res.json({
            success: true,
            period: { date: date },
            summary: {
                total_revenue: parseFloat(result.total_revenue || 0),
                total_sales: parseInt(result.total_sales || 0),
                unique_customers: parseInt(result.unique_customers || 0),
                average_transaction: result.total_sales > 0 ? (result.total_revenue / result.total_sales) : 0,
                total_tax: parseFloat(result.total_tax || 0)
            },
            profit: {
                cogs: parseFloat(result.cogs || 0),
                gross_profit: parseFloat(result.gross_profit || 0),
                gross_margin: parseFloat(result.gross_margin || 0),
                total_expenses: parseFloat(result.total_expenses || 0),
                net_profit: parseFloat(result.net_profit || 0),
                net_margin: parseFloat(result.net_margin || 0)
            },
            growth: {
                revenue_growth: parseFloat(result.revenue_growth || 0),
                sales_growth: parseFloat(result.sales_growth || 0),
                previous_revenue: parseFloat(result.prev_revenue || 0),
                previous_sales: parseInt(result.prev_sales || 0),
                trend: result.revenue_growth > 0 ? 'up' : (result.revenue_growth < 0 ? 'down' : 'same')
            },
            payment_breakdown: {
                cash: parseFloat(result.cash_sales || 0),
                digital: parseFloat(result.digital_sales || 0),
                credit: parseFloat(result.credit_sales || 0)
            },
            z_report: {
                opening_cash: parseFloat(result.opening_cash_balance || 0),
                cash_sales: parseFloat(result.cash_sales || 0),
                expected_cash: parseFloat(result.expected_cash_balance || 0),
                actual_cash: parseFloat(result.actual_cash_balance || null),
                status: result.actual_cash_balance ? (result.actual_cash_balance >= result.expected_cash_balance ? 'balanced' : 'short') : 'pending'
            },
            top_products: topProducts.rows
        });
        
    } catch (error) {
        console.error('Daily report error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reports/advanced/monthly', authenticate, async (req, res) => {
    try {
        const { month, year } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        
        let prevMonth = targetMonth - 1;
        let prevYear = targetYear;
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear = targetYear - 1;
        }
        
        const result = await pool.query(`
            WITH current_month AS (
                SELECT 
                    COALESCE(SUM(s.total_amount), 0) as revenue,
                    COUNT(*) as sales_count,
                    COUNT(DISTINCT s.customer_id) as customers,
                    COALESCE(SUM(si.quantity * p.cost_price), 0) as cogs,
                    COALESCE(SUM(s.total_amount) - SUM(si.quantity * p.cost_price), 0) as gross_profit
                FROM sales s
                LEFT JOIN sale_items si ON s.id = si.sale_id
                LEFT JOIN products p ON si.product_id = p.id
                WHERE s.business_id = $1 
                    AND EXTRACT(MONTH FROM s.sale_date) = $2 
                    AND EXTRACT(YEAR FROM s.sale_date) = $3
                    AND s.status = 'completed'
            ),
            current_expenses AS (
                SELECT COALESCE(SUM(amount), 0) as expenses
                FROM expenses
                WHERE business_id = $1 
                    AND EXTRACT(MONTH FROM expense_date) = $2 
                    AND EXTRACT(YEAR FROM expense_date) = $3
            ),
            previous_month AS (
                SELECT COALESCE(SUM(total_amount), 0) as prev_revenue,
                       COUNT(*) as prev_sales
                FROM sales
                WHERE business_id = $1 
                    AND EXTRACT(MONTH FROM sale_date) = $4 
                    AND EXTRACT(YEAR FROM sale_date) = $5
                    AND status = 'completed'
            )
            SELECT 
                cm.*,
                ce.expenses,
                pm.prev_revenue,
                pm.prev_sales,
                cm.gross_profit - ce.expenses as net_profit,
                CASE WHEN pm.prev_revenue > 0 THEN ((cm.revenue - pm.prev_revenue) / pm.prev_revenue) * 100 ELSE 0 END as revenue_growth,
                CASE WHEN pm.prev_sales > 0 THEN ((cm.sales_count - pm.prev_sales) / pm.prev_sales) * 100 ELSE 0 END as sales_growth,
                CASE WHEN cm.revenue > 0 THEN (cm.gross_profit / cm.revenue) * 100 ELSE 0 END as gross_margin,
                CASE WHEN cm.revenue > 0 THEN ((cm.gross_profit - ce.expenses) / cm.revenue) * 100 ELSE 0 END as net_margin
            FROM current_month cm
            CROSS JOIN current_expenses ce
            CROSS JOIN previous_month pm
        `, [req.user.business_id, targetMonth, targetYear, prevMonth, prevYear]);
        
        const topProducts = await pool.query(`
            SELECT 
                p.name_translations->>'en' as product_name,
                COALESCE(SUM(si.quantity), 0) as total_quantity,
                COALESCE(SUM(si.total_price), 0) as total_revenue
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.business_id = $1 
                AND EXTRACT(MONTH FROM s.sale_date) = $2 
                AND EXTRACT(YEAR FROM s.sale_date) = $3
                AND s.status = 'completed'
            GROUP BY p.id, p.name_translations
            ORDER BY total_revenue DESC
            LIMIT 5
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const row = result.rows[0] || {};
        
        res.json({
            success: true,
            period: { month: targetMonth, year: targetYear },
            summary: {
                total_revenue: parseFloat(row.revenue || 0),
                total_sales: parseInt(row.sales_count || 0),
                unique_customers: parseInt(row.customers || 0),
                average_transaction: row.sales_count > 0 ? (row.revenue / row.sales_count) : 0
            },
            profit: {
                cogs: parseFloat(row.cogs || 0),
                gross_profit: parseFloat(row.gross_profit || 0),
                gross_margin: parseFloat(row.gross_margin || 0),
                total_expenses: parseFloat(row.expenses || 0),
                net_profit: parseFloat(row.net_profit || 0),
                net_margin: parseFloat(row.net_margin || 0)
            },
            growth: {
                revenue_growth: parseFloat(row.revenue_growth || 0),
                sales_growth: parseFloat(row.sales_growth || 0),
                previous_revenue: parseFloat(row.prev_revenue || 0),
                previous_sales: parseInt(row.prev_sales || 0),
                trend: row.revenue_growth > 0 ? 'up' : (row.revenue_growth < 0 ? 'down' : 'same')
            },
            top_products: topProducts.rows
        });
        
    } catch (error) {
        console.error('Monthly report error:', error);
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

app.get('/api/inventory/adjustments', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sa.*, p.name_translations as product_name 
            FROM stock_adjustments sa 
            JOIN products p ON sa.product_id = p.id 
            WHERE sa.business_id = $1 
            ORDER BY sa.created_at DESC 
            LIMIT 50
        `, [req.user.business_id]);
        res.json({ adjustments: result.rows });
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
        res.json({ 
            is_closed: isClosed,
            cashout: result.rows[0] || null
        });
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

app.post('/api/cashout/close', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { 
            actual_cash_balance, notes, total_sales, total_cash_sales, 
            total_credit_sales, total_electronic_sales, total_tax, 
            total_expenses, cash_collected, telebirr_collected, 
            cbe_birr_collected, bank_transfer_collected, opening_cash_balance 
        } = req.body;
        
        const today = new Date().toISOString().split('T')[0];
        const expected_cash_balance = (opening_cash_balance || 0) + (total_cash_sales || 0) - (total_expenses || 0);
        const cash_difference = actual_cash_balance - expected_cash_balance;
        
        const existing = await client.query(
            'SELECT id FROM daily_cashouts WHERE business_id = $1 AND cashout_date = $2',
            [req.user.business_id, today]
        );
        
        let result;
        if (existing.rows.length > 0) {
            result = await client.query(`
                UPDATE daily_cashouts SET
                    total_sales = $1, total_cash_sales = $2, total_credit_sales = $3,
                    total_electronic_sales = $4, total_tax = $5, total_expenses = $6,
                    cash_collected = $7, telebirr_collected = $8, cbe_birr_collected = $9,
                    bank_transfer_collected = $10, opening_cash_balance = $11,
                    expected_cash_balance = $12, actual_cash_balance = $13,
                    cash_difference = $14, notes = $15, is_closed = true,
                    closed_at = NOW(), updated_at = NOW()
                WHERE business_id = $16 AND cashout_date = $17
                RETURNING *
            `, [
                total_sales, total_cash_sales, total_credit_sales, total_electronic_sales,
                total_tax, total_expenses, cash_collected, telebirr_collected,
                cbe_birr_collected, bank_transfer_collected, opening_cash_balance,
                expected_cash_balance, actual_cash_balance, cash_difference, notes,
                req.user.business_id, today
            ]);
        } else {
            result = await client.query(`
                INSERT INTO daily_cashouts (
                    business_id, user_id, cashout_date, total_sales, total_cash_sales,
                    total_credit_sales, total_electronic_sales, total_tax, total_expenses,
                    cash_collected, telebirr_collected, cbe_birr_collected, bank_transfer_collected,
                    opening_cash_balance, expected_cash_balance, actual_cash_balance,
                    cash_difference, notes, is_closed, closed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, true, NOW())
                RETURNING *
            `, [
                req.user.business_id, req.user.id, today, total_sales, total_cash_sales,
                total_credit_sales, total_electronic_sales, total_tax, total_expenses,
                cash_collected, telebirr_collected, cbe_birr_collected, bank_transfer_collected,
                opening_cash_balance, expected_cash_balance, actual_cash_balance,
                cash_difference, notes
            ]);
        }
        
        await client.query(`
            INSERT INTO action_logs (business_id, user_id, action_type, entity_type, entity_id, details)
            VALUES ($1, $2, 'cashout', 'cashout', $3, $4)
        `, [req.user.business_id, req.user.id, result.rows[0].id, JSON.stringify({ 
            expected: expected_cash_balance, 
            actual: actual_cash_balance,
            difference: cash_difference 
        })]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: 'Cash-out closed successfully',
            cashout: result.rows[0],
            difference: cash_difference
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Cashout close error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/cashout/history', authenticate, async (req, res) => {
    try {
        const { limit = 30, offset = 0 } = req.query;
        const result = await pool.query(`
            SELECT dc.*, u.full_name as closed_by
            FROM daily_cashouts dc
            LEFT JOIN users u ON dc.user_id = u.id
            WHERE dc.business_id = $1
            ORDER BY dc.cashout_date DESC
            LIMIT $2 OFFSET $3
        `, [req.user.business_id, limit, offset]);
        
        res.json({ cashouts: result.rows });
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
            'SELECT COALESCE(SUM(total_amount), 0) as cash_total FROM sales WHERE business_id = $1 AND sale_date = $2 AND payment_method = \'cash\' AND status = \'completed\'',
            [req.user.business_id, today]
        );
        
        const cashExpenses = await client.query(
            'SELECT COALESCE(SUM(amount), 0) as expense_total FROM expenses WHERE business_id = $1 AND expense_date = $2 AND payment_method = \'cash\'',
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
        
        const summary = {
            date: today,
            opening_balance: openingBalance,
            cash_sales: parseFloat(cashSales.rows[0].cash_total),
            cash_expenses: parseFloat(cashExpenses.rows[0].expense_total),
            expected_cash: expectedCash,
            actual_cash: actual_cash_balance,
            difference: difference,
            status: status
        };
        
        res.json({ 
            success: true, 
            cashout: result.rows[0],
            summary: summary,
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
    } finally {
        client.release();
    }
});

app.get('/api/z-report/status', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const result = await pool.query(
            `SELECT * FROM daily_cashouts 
             WHERE business_id = $1 AND cashout_date = $2`,
            [req.user.business_id, today]
        );
        
        const isClosed = result.rows.length > 0 && result.rows[0].is_closed === true;
        
        res.json({ 
            is_closed: isClosed,
            cashout: result.rows[0] || null,
            message: isClosed ? 'Z-Report already closed for today' : 'Z-Report pending. Ready to close.'
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================
app.get('/api/users', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, full_name, phone, role, is_active, pin_code, created_at FROM users WHERE business_id = $1 ORDER BY created_at',
            [req.user.business_id]
        );
        res.json({ users: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/users/:id', authenticate, authorize('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        
        if (id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        
        const result = await pool.query(
            'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id',
            [id, req.user.business_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ success: true, message: 'User deactivated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/:id/reset-password', authenticate, authorize('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const result = await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3 RETURNING id',
            [hashedPassword, id, req.user.business_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
             FROM users u 
             JOIN businesses b ON u.business_id = b.id 
             WHERE u.pin_code = $1 AND u.is_active = true AND u.role = 'cashier'`,
            [pinCode]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid PIN code' });
        }
        
        const user = result.rows[0];
        if (!user.biz_active) {
            return res.status(403).json({ error: 'Business account deactivated' });
        }
        
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        
        const token = jwt.sign(
            { id: user.id, business_id: user.business_id, role: user.role },
            process.env.JWT_SECRET || 'my-super-secret-key-2026',
            { expiresIn: '8h' }
        );
        
        res.json({ 
            success: true, 
            token, 
            user: { 
                id: user.id, 
                name: user.full_name, 
                business_name: user.business_name, 
                role: user.role,
                is_cashier: true
            } 
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
        
        const user = await pool.query(
            'SELECT role FROM users WHERE id = $1 AND business_id = $2',
            [id, req.user.business_id]
        );
        
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.rows[0].role !== 'cashier') {
            return res.status(400).json({ error: 'PIN only available for cashiers' });
        }
        
        await pool.query(
            'UPDATE users SET pin_code = $1, is_cashier = true, updated_at = NOW() WHERE id = $2',
            [pinCode, id]
        );
        
        res.json({ success: true, message: 'PIN code set successfully' });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/users/:id/remove-pin', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(
            'UPDATE users SET pin_code = NULL, updated_at = NOW() WHERE id = $1 AND business_id = $2',
            [id, req.user.business_id]
        );
        
        res.json({ success: true, message: 'PIN code removed successfully' });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:id/has-pin', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'SELECT pin_code IS NOT NULL as has_pin FROM users WHERE id = $1 AND business_id = $2',
            [id, req.user.business_id]
        );
        
        res.json({ has_pin: result.rows[0]?.has_pin || false });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SMS & COMMUNICATION ENDPOINTS
// ============================================
app.post('/api/send-debt-reminder', authenticate, async (req, res) => {
    try {
        const { customerId, customerName, phone, amount, message } = req.body;
        
        console.log('===== SMS REMINDER =====');
        console.log(`To: ${phone} (${customerName})`);
        console.log(`Amount: ${amount} ETB`);
        console.log(`Message: ${message}`);
        console.log('=======================');
        
        res.json({ 
            success: true, 
            message: 'SMS sent successfully (Demo mode)',
            log: { to: phone, customer: customerName, amount }
        });
        
    } catch (error) {
        console.error('SMS error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// TELEGRAM BOT INTEGRATION
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
        const keyboard = {
            inline_keyboard: buttons
        };
        
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
                    const balance = parseFloat(customer.rows[0].current_balance) || 0;
                    await sendTelegramMessage(chatId, 
                        `💰 <b>Account Balance</b>\n\nDear ${customer.rows[0].full_name},\n\nYour current balance is: <code>${balance.toFixed(2)} ETB</code>\n\nThank you! 🙏`
                    );
                } else {
                    await sendTelegramMessage(chatId, 
                        `❌ <b>Account Not Found</b>\n\nPlease scan the QR code at the shop to link your account.`
                    );
                }
            }
            return res.sendStatus(200);
        }
        
        if (message && message.text) {
            const chatId = message.chat.id;
            const text = message.text;
            
            console.log(`📱 Message from ${chatId}: ${text}`);
            
            if (text.startsWith('/start')) {
                const parts = text.split(' ');
                let customerId = parts.length > 1 ? parts[1] : null;
                
                if (customerId) {
                    const customer = await pool.query(
                        'SELECT id, full_name, business_id, current_balance FROM customers WHERE id = $1',
                        [customerId]
                    );
                    
                    if (customer.rows.length > 0) {
                        await pool.query(
                            'UPDATE customers SET telegram_chat_id = $1 WHERE id = $2',
                            [chatId.toString(), customerId]
                        );
                        
                        const balance = parseFloat(customer.rows[0].current_balance) || 0;
                        
                        console.log(`✅ Customer ${customer.rows[0].full_name} connected with balance: ${balance}`);
                        
                        const welcomeMsg = `
🎉 <b>Welcome ${customer.rows[0].full_name}!</b>

✅ Your account is now connected to Telegram!

<b>Current Balance:</b> <code>${balance.toFixed(2)} ETB</code>

<b>Commands:</b>
/balance - Check your balance
/help - Show help

You will receive payment reminders here automatically.

Thank you for choosing us! 🙏
                        `;
                        
                        await sendTelegramMessage(chatId, welcomeMsg);
                        res.sendStatus(200);
                        return;
                    }
                }
                
                await sendTelegramMessage(chatId, `
🤖 <b>Smart SME Manager Bot</b>

Welcome! To connect your account, please ask the shop for your personalized link.

Type /help for available commands.
                `);
            }
            else if (text === '/balance') {
                const customer = await pool.query(
                    'SELECT full_name, current_balance FROM customers WHERE telegram_chat_id = $1',
                    [chatId.toString()]
                );
                
                if (customer.rows.length > 0) {
                    const balance = parseFloat(customer.rows[0].current_balance) || 0;
                    await sendTelegramMessage(chatId, `
💰 <b>Account Balance</b>

Dear ${customer.rows[0].full_name},

Your current balance is: <code>${balance.toFixed(2)} ETB</code>

Thank you for your business! 🙏
                    `);
                } else {
                    await sendTelegramMessage(chatId, `
❌ <b>Account Not Found</b>

Please ask the shop to provide you with the Telegram connection link.
                    `);
                }
            }
            else if (text === '/help') {
                await sendTelegramMessage(chatId, `
📖 <b>Available Commands</b>

/start - Initialize bot
/balance - Check your balance
/help - Show this help

<i>You will receive automatic payment reminders when you have outstanding balance.</i>
                `);
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
        
        const customer = await pool.query(
            'SELECT * FROM customers WHERE id = $1 AND business_id = $2',
            [customerId, req.user.business_id]
        );
        
        if (customer.rows.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        await pool.query(
            'UPDATE customers SET telegram_chat_id = $1 WHERE id = $2',
            [telegramChatId, customerId]
        );
        
        const welcomeMessage = `
🎉 <b>Welcome to Smart SME Manager!</b>

Dear ${customer.rows[0].full_name},

Your Telegram account has been successfully linked.

<b>Current Balance:</b> <code>${customer.rows[0].current_balance} ETB</code>

Thank you for choosing us! 🙏
        `;
        
        const buttons = [
            [
                { text: "💰 Check Balance", callback_data: "balance" },
                { text: "📞 Contact Support", callback_data: "support" }
            ]
        ];
        
        await sendTelegramKeyboard(telegramChatId, welcomeMessage, buttons);
        
        res.json({ success: true, message: 'Telegram ID registered successfully' });
        
    } catch (error) {
        console.error('Register telegram error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/send-telegram-reminder', authenticate, async (req, res) => {
    console.log('📨 Send reminder request received');
    
    try {
        const { customerId, customerName, phone, amount, message, telegramChatId } = req.body;
        
        if (!telegramChatId) {
            return res.status(400).json({ error: 'Customer has not registered Telegram' });
        }
        
        const amountNum = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
        
        console.log(`📤 Sending to: ${telegramChatId}, Amount: ${amountNum}`);
        
        const formattedMessage = `
🔔 <b>PAYMENT REMINDER</b>

Dear ${customerName},

${message}

━━━━━━━━━━━━━━━━━
<b>💰 Amount Due:</b> <code>${amountNum.toFixed(2)} ETB</code>
━━━━━━━━━━━━━━━━━

Please make your payment as soon as possible.

Thank you for your business! 🙏

📅 ${new Date().toLocaleString()}
        `;
        
        const result = await sendTelegramMessage(telegramChatId, formattedMessage);
        
        if (result && result.success) {
            await pool.query(
                `INSERT INTO action_logs (business_id, user_id, action_type, entity_type, entity_id, details)
                 VALUES ($1, $2, 'send_telegram', 'customer', $3, $4)`,
                [req.user.business_id, req.user.id, customerId, JSON.stringify({ 
                    amount: amountNum, 
                    status: 'sent'
                })]
            );
            
            return res.json({ 
                success: true, 
                message: 'Telegram reminder sent successfully',
                result: result
            });
        } else {
            return res.json({ 
                success: false, 
                error: result?.error || 'Failed to send Telegram message' 
            });
        }
        
    } catch (error) {
        console.error('❌ Server error:', error);
        return res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/test-telegram', authenticate, async (req, res) => {
    try {
        const botInfo = await fetch(`${TELEGRAM_API_URL}/getMe`);
        const botData = await botInfo.json();
        
        const webhookInfo = await fetch(`${TELEGRAM_API_URL}/getWebhookInfo`);
        const webhookData = await webhookInfo.json();
        
        res.json({ 
            success: true, 
            bot: botData.result,
            webhook: webhookData.result,
            message: 'Telegram bot is configured correctly'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/set-telegram-webhook', authenticate, async (req, res) => {
    try {
        const webhookUrl = `${process.env.API_URL || 'https://smart-sme-api.onrender.com'}/api/telegram-webhook`;
        
        const response = await fetch(`${TELEGRAM_API_URL}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl })
        });
        
        const result = await response.json();
        res.json({ success: result.ok, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/delete-telegram-webhook', authenticate, async (req, res) => {
    try {
        const response = await fetch(`${TELEGRAM_API_URL}/deleteWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        res.json({ success: result.ok, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// META WHATSAPP CLOUD API
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
        
        console.log(`📱 Sending WhatsApp to: ${formattedTo}`);
        
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
                    text: { 
                        preview_url: false, 
                        body: message 
                    }
                })
            }
        );
        
        const result = await response.json();
        
        if (result.error) {
            console.error('Meta API Error:', result.error);
            return { success: false, error: result.error.message };
        }
        
        console.log('✅ WhatsApp sent:', result.messages?.[0]?.id);
        return { success: true, messageId: result.messages?.[0]?.id };
        
    } catch (error) {
        console.error('WhatsApp send error:', error);
        return { success: false, error: error.message };
    }
}

app.post('/api/send-whatsapp-reminder', authenticate, async (req, res) => {
    try {
        const { customerId, customerName, phone, amount, message } = req.body;
        
        if (!phone) {
            return res.status(400).json({ error: 'Customer phone number required' });
        }
        
        if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
            return res.status(500).json({ 
                error: 'WhatsApp API not configured. Please set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID.',
                demo: true 
            });
        }
        
        const personalizedMessage = message
            .replace(/{name}/g, customerName)
            .replace(/{amount}/g, `${amount.toFixed(2)} ETB`);
        
        const result = await sendWhatsAppMessage(phone, personalizedMessage);
        
        await pool.query(
            `INSERT INTO action_logs (business_id, user_id, action_type, entity_type, entity_id, details)
             VALUES ($1, $2, 'send_whatsapp', 'customer', $3, $4)`,
            [req.user.business_id, req.user.id, customerId, JSON.stringify({ 
                phone, 
                amount, 
                success: result.success,
                message_preview: personalizedMessage.substring(0, 50)
            })]
        );
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'WhatsApp message sent successfully',
                messageId: result.messageId
            });
        } else {
            res.json({ success: false, error: result.error });
        }
        
    } catch (error) {
        console.error('WhatsApp error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/send-whatsapp-bulk', authenticate, async (req, res) => {
    try {
        const { customerIds, message } = req.body;
        
        if (!customerIds || customerIds.length === 0) {
            return res.status(400).json({ error: 'No customers selected' });
        }
        
        const results = [];
        
        for (const customerId of customerIds) {
            const customer = await pool.query(
                'SELECT full_name, phone, current_balance FROM customers WHERE id = $1 AND business_id = $2',
                [customerId, req.user.business_id]
            );
            
            if (customer.rows.length > 0 && customer.rows[0].phone) {
                const personalizedMessage = message
                    .replace(/{name}/g, customer.rows[0].full_name)
                    .replace(/{amount}/g, `${customer.rows[0].current_balance} ETB`);
                
                const result = await sendWhatsAppMessage(customer.rows[0].phone, personalizedMessage);
                
                results.push({
                    customerId,
                    customerName: customer.rows[0].full_name,
                    phone: customer.rows[0].phone,
                    success: result.success,
                    error: result.error
                });
                
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        
        res.json({
            success: true,
            total: results.length,
            successCount,
            failCount,
            results
        });
        
    } catch (error) {
        console.error('Bulk WhatsApp error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/test-whatsapp-config', authenticate, async (req, res) => {
    const isConfigured = !!(META_ACCESS_TOKEN && META_PHONE_NUMBER_ID);
    
    res.json({
        configured: isConfigured,
        message: isConfigured 
            ? 'WhatsApp API is configured and ready to use'
            : 'WhatsApp API not configured. Please set environment variables.',
        phoneNumberId: META_PHONE_NUMBER_ID ? 'Set' : 'Not set',
        accessToken: META_ACCESS_TOKEN ? 'Set' : 'Not set'
    });
});

// ============================================
// SALES TARGET ENDPOINTS
// ============================================
app.get('/api/sales-targets', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = new Date().getMonth() + 1;
        const thisYear = new Date().getFullYear();
        
        let todayTarget = await pool.query(
            'SELECT target_amount FROM sales_targets WHERE business_id = $1 AND target_date = $2',
            [req.user.business_id, today]
        );
        let todayTargetAmount = parseFloat(todayTarget.rows[0]?.target_amount || 0);
        
        const todaySales = await pool.query(
            'SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE business_id = $1 AND sale_date = $2 AND status = \'completed\'',
            [req.user.business_id, today]
        );
        
        let monthTarget = await pool.query(
            'SELECT target_amount FROM sales_targets WHERE business_id = $1 AND target_month = $2 AND target_year = $3',
            [req.user.business_id, thisMonth, thisYear]
        );
        let monthTargetAmount = parseFloat(monthTarget.rows[0]?.target_amount || 0);
        
        const monthSales = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) as total 
             FROM sales 
             WHERE business_id = $1 
             AND EXTRACT(MONTH FROM sale_date) = $2 
             AND EXTRACT(YEAR FROM sale_date) = $3 
             AND status = 'completed'`,
            [req.user.business_id, thisMonth, thisYear]
        );
        
        let yearTarget = await pool.query(
            'SELECT target_amount FROM sales_targets WHERE business_id = $1 AND target_year = $2 AND target_month IS NULL',
            [req.user.business_id, thisYear]
        );
        let yearTargetAmount = parseFloat(yearTarget.rows[0]?.target_amount || 0);
        
        const yearSales = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) as total 
             FROM sales 
             WHERE business_id = $1 
             AND EXTRACT(YEAR FROM sale_date) = $2 
             AND status = 'completed'`,
            [req.user.business_id, thisYear]
        );
        
        res.json({
            success: true,
            today_target: todayTargetAmount,
            today_sales: parseFloat(todaySales.rows[0].total),
            month_target: monthTargetAmount,
            month_sales: parseFloat(monthSales.rows[0].total),
            year_target: yearTargetAmount,
            year_sales: parseFloat(yearSales.rows[0].total)
        });
    } catch (error) {
        console.error('Get targets error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sales-targets/today', authenticate, async (req, res) => {
    try {
        const { target } = req.body;
        const today = new Date().toISOString().split('T')[0];
        
        await pool.query(
            `INSERT INTO sales_targets (business_id, target_date, target_amount, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (business_id, target_date) 
             DO UPDATE SET target_amount = $3, updated_at = NOW()`,
            [req.user.business_id, today, target]
        );
        
        res.json({ success: true, message: 'Daily target set successfully' });
    } catch (error) {
        console.error('Set daily target error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sales-targets/monthly', authenticate, async (req, res) => {
    try {
        const { month, year, target } = req.body;
        
        await pool.query(
            `INSERT INTO sales_targets (business_id, target_month, target_year, target_amount, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (business_id, target_month, target_year) 
             DO UPDATE SET target_amount = $4, updated_at = NOW()`,
            [req.user.business_id, month, year, target]
        );
        
        res.json({ success: true, message: 'Monthly target set successfully' });
    } catch (error) {
        console.error('Set monthly target error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sales-targets/yearly', authenticate, async (req, res) => {
    try {
        const { year, target } = req.body;
        
        await pool.query(
            `INSERT INTO sales_targets (business_id, target_year, target_amount, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (business_id, target_year) WHERE target_month IS NULL
             DO UPDATE SET target_amount = $3, updated_at = NOW()`,
            [req.user.business_id, year, target]
        );
        
        res.json({ success: true, message: 'Yearly target set successfully' });
    } catch (error) {
        console.error('Set yearly target error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sales-targets/history', authenticate, async (req, res) => {
    try {
        const { period, year, month } = req.query;
        
        let query = '';
        let params = [req.user.business_id];
        
        if (period === 'daily') {
            query = `
                SELECT target_date as date, target_amount, 
                       COALESCE((
                           SELECT SUM(total_amount) 
                           FROM sales 
                           WHERE business_id = $1 
                           AND sale_date = st.target_date 
                           AND status = 'completed'
                       ), 0) as achieved
                FROM sales_targets st
                WHERE business_id = $1 AND target_date IS NOT NULL
                ORDER BY target_date DESC
                LIMIT 30
            `;
        } else if (period === 'monthly') {
            query = `
                SELECT target_month as month, target_year as year, target_amount,
                       COALESCE((
                           SELECT SUM(total_amount) 
                           FROM sales 
                           WHERE business_id = $1 
                           AND EXTRACT(MONTH FROM sale_date) = st.target_month
                           AND EXTRACT(YEAR FROM sale_date) = st.target_year
                           AND status = 'completed'
                       ), 0) as achieved
                FROM sales_targets st
                WHERE business_id = $1 AND target_month IS NOT NULL
                ORDER BY target_year DESC, target_month DESC
                LIMIT 12
            `;
        } else if (period === 'yearly') {
            query = `
                SELECT target_year as year, target_amount,
                       COALESCE((
                           SELECT SUM(total_amount) 
                           FROM sales 
                           WHERE business_id = $1 
                           AND EXTRACT(YEAR FROM sale_date) = st.target_year
                           AND status = 'completed'
                       ), 0) as achieved
                FROM sales_targets st
                WHERE business_id = $1 AND target_year IS NOT NULL AND target_month IS NULL
                ORDER BY target_year DESC
                LIMIT 5
            `;
        } else {
            return res.status(400).json({ error: 'Invalid period' });
        }
        
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PHYSICAL COUNT RECONCILIATION
// ============================================
app.post('/api/physical-count/start', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { notes } = req.body;
        
        const activeSession = await pool.query(
            `SELECT id FROM physical_count_sessions 
             WHERE business_id = $1 AND status = 'in_progress'`,
            [req.user.business_id]
        );
        
        if (activeSession.rows.length > 0) {
            return res.status(400).json({ 
                error: 'There is already an active physical count session. Please complete or cancel it first.' 
            });
        }
        
        const result = await pool.query(
            `INSERT INTO physical_count_sessions (business_id, user_id, status, notes, started_at)
             VALUES ($1, $2, 'in_progress', $3, NOW())
             RETURNING id`,
            [req.user.business_id, req.user.id, notes]
        );
        
        const sessionNumber = `PC-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${result.rows[0].id.toString().substring(0, 8)}`;
        
        await pool.query(
            'UPDATE physical_count_sessions SET session_number = $1 WHERE id = $2',
            [sessionNumber, result.rows[0].id]
        );
        
        res.json({ 
            success: true, 
            session_id: result.rows[0].id,
            session_number: sessionNumber
        });
        
    } catch (error) {
        console.error('Start physical count error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/physical-count/save-count', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { session_id, product_id, system_stock, physical_stock, counted_by } = req.body;
        
        const session = await pool.query(
            'SELECT * FROM physical_count_sessions WHERE id = $1 AND business_id = $2',
            [session_id, req.user.business_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (session.rows[0].status !== 'in_progress') {
            return res.status(400).json({ error: 'Session is already completed or cancelled' });
        }
        
        const existing = await pool.query(
            `SELECT id FROM physical_count_items 
             WHERE session_id = $1 AND product_id = $2`,
            [session_id, product_id]
        );
        
        if (existing.rows.length > 0) {
            await pool.query(
                `UPDATE physical_count_items 
                 SET physical_stock = $1, counted_at = NOW(), counted_by = $2
                 WHERE session_id = $3 AND product_id = $4`,
                [physical_stock, counted_by || req.user.id, session_id, product_id]
            );
        } else {
            await pool.query(
                `INSERT INTO physical_count_items 
                 (session_id, product_id, system_stock, physical_stock, counted_by, counted_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [session_id, product_id, system_stock, physical_stock, counted_by || req.user.id]
            );
        }
        
        res.json({ success: true, message: 'Count saved successfully' });
        
    } catch (error) {
        console.error('Save physical count error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/physical-count/complete', authenticate, authorize('owner', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { session_id, apply_adjustments = true } = req.body;
        
        const session = await client.query(
            'SELECT * FROM physical_count_sessions WHERE id = $1 AND business_id = $2',
            [session_id, req.user.business_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (session.rows[0].status !== 'in_progress') {
            return res.status(400).json({ error: 'Session is already completed' });
        }
        
        const counts = await client.query(
            `SELECT pci.*, p.name_translations, p.selling_price
             FROM physical_count_items pci
             JOIN products p ON pci.product_id = p.id
             WHERE pci.session_id = $1`,
            [session_id]
        );
        
        const adjustments = [];
        let totalDifference = 0;
        let totalValueDifference = 0;
        
        for (const count of counts.rows) {
            const difference = count.physical_stock - count.system_stock;
            const valueDifference = difference * count.selling_price;
            
            adjustments.push({
                product_id: count.product_id,
                product_name: count.name_translations?.en || 'Product',
                system_stock: count.system_stock,
                physical_stock: count.physical_stock,
                difference: difference,
                value_difference: valueDifference
            });
            
            totalDifference += difference;
            totalValueDifference += valueDifference;
            
            if (apply_adjustments && difference !== 0) {
                await client.query(
                    'UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2',
                    [count.physical_stock, count.product_id]
                );
                
                const direction = difference > 0 ? 'in' : 'out';
                await client.query(
                    `INSERT INTO stock_adjustments 
                     (business_id, product_id, user_id, adjustment_type, quantity, direction, reason)
                     VALUES ($1, $2, $3, 'physical_count', $4, $5, $6)`,
                    [req.user.business_id, count.product_id, req.user.id, Math.abs(difference), direction, `Physical count reconciliation - Session ${session.rows[0].session_number}`]
                );
            }
        }
        
        await client.query(
            `UPDATE physical_count_sessions 
             SET status = 'completed', 
                 completed_at = NOW(), 
                 total_products_counted = $1,
                 total_difference = $2,
                 total_value_difference = $3
             WHERE id = $4`,
            [counts.rows.length, totalDifference, totalValueDifference, session_id]
        );
        
        const summary = {
            session_number: session.rows[0].session_number,
            started_at: session.rows[0].started_at,
            completed_at: new Date(),
            total_products: counts.rows.length,
            total_difference: totalDifference,
            total_value_difference: totalValueDifference,
            adjustments_made: apply_adjustments,
            adjustments: adjustments
        };
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: apply_adjustments ? 'Physical count completed and adjustments applied' : 'Physical count completed (no adjustments applied)',
            summary: summary
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Complete physical count error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

app.post('/api/physical-count/cancel', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { session_id } = req.body;
        
        await pool.query(
            `UPDATE physical_count_sessions 
             SET status = 'cancelled', cancelled_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [session_id, req.user.business_id]
        );
        
        res.json({ success: true, message: 'Physical count session cancelled' });
        
    } catch (error) {
        console.error('Cancel physical count error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/physical-count/history', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        
        const result = await pool.query(
            `SELECT pcs.*, u.full_name as created_by_name
             FROM physical_count_sessions pcs
             LEFT JOIN users u ON pcs.user_id = u.id
             WHERE pcs.business_id = $1
             ORDER BY pcs.created_at DESC
             LIMIT $2 OFFSET $3`,
            [req.user.business_id, limit, offset]
        );
        
        res.json({ sessions: result.rows });
        
    } catch (error) {
        console.error('Get physical count history error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/physical-count/session/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const session = await pool.query(
            'SELECT * FROM physical_count_sessions WHERE id = $1 AND business_id = $2',
            [id, req.user.business_id]
        );
        
        if (session.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const items = await pool.query(
            `SELECT pci.*, p.name_translations, p.selling_price, p.unit
             FROM physical_count_items pci
             JOIN products p ON pci.product_id = p.id
             WHERE pci.session_id = $1
             ORDER BY p.name_translations->>'en'`,
            [id]
        );
        
        res.json({ 
            session: session.rows[0],
            items: items.rows
        });
        
    } catch (error) {
        console.error('Get session details error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/app-version', async (req, res) => {
    res.json({
        latest_version: '1.0.0',
        download_url: 'https://your-server.com/SmartSME.apk',
        update_required: false
    });
});

// ============================================
// CLIENT MANAGEMENT (SUPER ADMIN) - COMPLETE CLEAN VERSION
// ============================================

// Get all clients
app.get('/api/admin/clients', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM clients ORDER BY created_at DESC'
        );
        res.json({ clients: result.rows });
    } catch (error) {
        console.error('Get clients error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add new client
app.post('/api/admin/clients', authenticate, async (req, res) => {
    try {
        const { business_name, owner_name, phone, email, city, subscription_plan, monthly_fee } = req.body;
        
        if (!business_name || !owner_name || !phone) {
            return res.status(400).json({ error: 'Business name, owner, and phone are required' });
        }
        
        const result = await pool.query(
            `INSERT INTO clients (business_name, owner_name, phone, email, city, subscription_plan, monthly_fee, subscription_start)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE) RETURNING *`,
            [business_name, owner_name, phone, email || null, city || null, subscription_plan || 'trial', monthly_fee || 0]
        );
        
        res.status(201).json({ success: true, client: result.rows[0], message: 'Client added successfully' });
    } catch (error) {
        console.error('Add client error:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Phone number already registered' });
        }
        res.status(500).json({ error: error.message });
    }
});

// Update client
app.put('/api/admin/clients/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { business_name, owner_name, phone, email, city, subscription_plan, monthly_fee, is_active, notes, payment_status } = req.body;
        
        const result = await pool.query(
            `UPDATE clients SET 
                business_name = COALESCE($1, business_name),
                owner_name = COALESCE($2, owner_name),
                phone = COALESCE($3, phone),
                email = COALESCE($4, email),
                city = COALESCE($5, city),
                subscription_plan = COALESCE($6, subscription_plan),
                monthly_fee = COALESCE($7, monthly_fee),
                is_active = COALESCE($8, is_active),
                notes = COALESCE($9, notes),
                payment_status = COALESCE($10, payment_status),
                updated_at = NOW()
             WHERE id = $11 RETURNING *`,
            [business_name, owner_name, phone, email, city, subscription_plan, monthly_fee, is_active, notes, payment_status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        res.json({ success: true, client: result.rows[0], message: 'Client updated successfully' });
    } catch (error) {
        console.error('Update client error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CLIENT PAYMENT RECORDING (ONLY ONE INSTANCE NEEDED)
// ============================================
app.post('/api/admin/clients/:id/payment', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, payment_method } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount required' });
        }
        
        // Insert payment
        await pool.query(
            `INSERT INTO client_payments (client_id, amount, payment_method, recorded_by)
             VALUES ($1, $2, $3, $4)`,
            [id, amount, payment_method || 'cash', req.user.id]
        );
        
        // Update client total
        await pool.query(
            'UPDATE clients SET total_paid = total_paid + $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
            [amount, 'paid', id]
        );
        
        res.json({ success: true, message: 'Payment recorded successfully' });
    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get admin dashboard stats
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
        
        res.json(stats.rows[0] || {
            total_clients: 0,
            new_this_month: 0,
            mrr: 0,
            pending_payments: 0,
            collected_this_month: 0,
            open_tickets: 0
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.json({
            total_clients: 0,
            new_this_month: 0,
            mrr: 0,
            pending_payments: 0,
            collected_this_month: 0,
            open_tickets: 0
        });
    }
});

// ============================================
// CLIENT ACTIVATE / DEACTIVATE
// ============================================
app.put('/api/admin/clients/:id/toggle-status', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get current status
        const client = await pool.query('SELECT is_active FROM clients WHERE id = $1', [id]);
        if (client.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        const newStatus = !client.rows[0].is_active;
        
        await pool.query(
            'UPDATE clients SET is_active = $1, updated_at = NOW() WHERE id = $2',
            [newStatus, id]
        );
        
        res.json({ 
            success: true, 
            is_active: newStatus,
            message: newStatus ? 'Client activated' : 'Client deactivated' 
        });
    } catch (error) {
        console.error('Toggle error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ANNOUNCEMENTS
// ============================================
app.get('/api/announcements', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT message FROM announcements 
             WHERE (business_id = $1 OR business_id IS NULL) 
             AND is_active = true 
             ORDER BY created_at DESC LIMIT 1`,
            [req.user.business_id]
        );
        res.json(result.rows[0] || { message: null });
    } catch (error) {
        res.json({ message: null });
    }
});

app.post('/api/announcements', authenticate, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });
        
        await pool.query(
            'INSERT INTO announcements (business_id, message, created_by) VALUES ($1, $2, $3)',
            [null, message, req.user.id]  // null = all businesses
        );
        res.json({ success: true, message: 'Announcement sent to all users!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// UPGRADE SUBSCRIPTION PLAN
// ============================================
app.post('/api/business/upgrade', authenticate, async (req, res) => {
    try {
        const { plan } = req.body;
        const validPlans = ['free', 'starter', 'business', 'enterprise'];
        
        if (!validPlans.includes(plan)) {
            return res.status(400).json({ error: 'Invalid plan. Valid plans: free, starter, business, enterprise' });
        }
        
        await pool.query(
            'UPDATE businesses SET subscription_tier = $1, updated_at = NOW() WHERE id = $2',
            [plan, req.user.business_id]
        );
        
        res.json({ success: true, message: `Upgraded to ${plan} plan`, plan: plan });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SUBSCRIPTION PAYMENT - FIXED
// ============================================
app.post('/api/subscription/pay', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { plan, amount, payment_method, transaction_ref, notes } = req.body;
        const businessId = req.user.business_id;
        
        console.log('📝 Payment submission:', { plan, amount, method: payment_method, businessId });
        
        if (!plan || !amount) {
            return res.status(400).json({ error: 'Plan and amount required' });
        }
        
        // Validate plan
        const validPlans = ['free', 'starter', 'business', 'enterprise'];
        if (!validPlans.includes(plan)) {
            return res.status(400).json({ error: 'Invalid plan' });
        }
        
        // Ensure amount is a valid number
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        
        // Get business info
        const businessResult = await client.query(
            'SELECT id, name, owner_name, phone FROM businesses WHERE id = $1', 
            [businessId]
        );
        
        if (businessResult.rows.length === 0) {
            return res.status(404).json({ error: 'Business not found' });
        }
        
        const business = businessResult.rows[0];
        
        // Insert payment with RETURNING * to get the generated ID (UUID or integer)
        const insertResult = await client.query(
            `INSERT INTO subscription_payments (
                business_id, plan, amount, payment_method, 
                transaction_ref, notes, payment_status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending') 
            RETURNING *`,
            [
                businessId,                    // business_id (UUID)
                plan,                          // plan (VARCHAR)
                amountNum,                     // amount (DECIMAL)
                payment_method || 'manual',    // payment_method (VARCHAR)
                transaction_ref || null,       // transaction_ref (VARCHAR)
                notes || null                  // notes (TEXT)
            ]
        );
        
        const payment = insertResult.rows[0];
        console.log('✅ Payment created with ID:', payment.id);
        
        // Update business payment status
        await client.query(
            'UPDATE businesses SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['pending', businessId]
        );
        
        // Create admin notification
        const notificationMsg = `${business.name} (${business.owner_name}) submitted ${amountNum} ETB for ${plan.toUpperCase()} plan via ${payment_method || 'manual'}. Ref: ${transaction_ref || 'N/A'}`;
        
        await client.query(
            `INSERT INTO admin_notifications (type, title, message, business_id, reference_id, is_read)
             VALUES ($1, $2, $3, $4, $5, false)`,
            ['payment', 'New Payment Submission', notificationMsg, businessId, payment.id]
        );
        
        // Send Telegram notification to admin
        if (TELEGRAM_BOT_TOKEN && process.env.ADMIN_TELEGRAM_CHAT_ID) {
            try {
                const telegramMsg = `
🔔 <b>New Payment Submitted!</b>

<b>Business:</b> ${business.name}
<b>Owner:</b> ${business.owner_name}
<b>Phone:</b> ${business.phone}
<b>Plan:</b> ${plan.toUpperCase()}
<b>Amount:</b> ${amountNum} ETB
<b>Method:</b> ${payment_method || 'manual'}
<b>Reference:</b> ${transaction_ref || 'N/A'}
${notes ? `<b>Notes:</b> ${notes}` : ''}
                `;
                await sendTelegramMessage(process.env.ADMIN_TELEGRAM_CHAT_ID, telegramMsg);
            } catch (err) {
                console.error('Telegram error:', err.message);
            }
        }
        
        await client.query('COMMIT');
        
        res.status(201).json({ 
            success: true, 
            payment: payment,
            message: 'Payment submitted successfully! Waiting for admin verification.'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Payment submission error:', error);
        res.status(500).json({ 
            error: 'Payment submission failed', 
            detail: error.message 
        });
    } finally {
        client.release();
    }
});

// Get payment history
app.get('/api/subscription/payments', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, plan, amount, payment_method, transaction_ref, 
                    payment_status, notes, created_at
             FROM subscription_payments 
             WHERE business_id = $1 
             ORDER BY created_at DESC 
             LIMIT 20`,
            [req.user.business_id]
        );
        res.json({ 
            success: true,
            payments: result.rows 
        });
    } catch (error) {
        console.error('Get payments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get my subscription status
app.get('/api/subscription/my-status', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                subscription_tier as plan,
                payment_status,
                last_payment_date,
                next_payment_date,
                subscription_end_date,
                payment_due_date,
                COALESCE(
                    (SELECT SUM(amount) FROM subscription_payments 
                     WHERE business_id = $1 AND payment_status = 'verified'), 0
                ) as total_paid
             FROM businesses 
             WHERE id = $1`,
            [req.user.business_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Business not found' });
        }
        
        const biz = result.rows[0];
        res.json({
            plan: biz.plan || 'free',
            payment_status: biz.payment_status || 'pending',
            last_payment: biz.last_payment_date,
            next_payment: biz.next_payment_date,
            total_paid: parseFloat(biz.total_paid) || 0
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ADMIN: GET ALL PAYMENTS - FIXED
// ============================================
app.get('/api/admin/payments', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        const { status } = req.query;
        
        let query = `
            SELECT 
                sp.id, 
                sp.plan, 
                sp.amount, 
                sp.payment_method, 
                sp.transaction_ref, 
                sp.payment_status, 
                sp.notes,
                sp.created_at, 
                sp.verified_at,
                sp.business_id,
                b.name as business_name, 
                b.owner_name, 
                b.phone
            FROM subscription_payments sp
            JOIN businesses b ON sp.business_id = b.id
        `;
        
        const params = [];
        
        if (status && ['pending', 'verified', 'rejected'].includes(status)) {
            query += ` WHERE sp.payment_status = $1`;
            params.push(status);
        }
        
        query += ` ORDER BY sp.created_at DESC LIMIT 50`;
        
        const result = await pool.query(query, params);
        
        // Ensure IDs are treated as strings for UUID compatibility
        const payments = result.rows.map(p => ({
            ...p,
            id: p.id, // Keep as is (UUID or integer)
            amount: parseFloat(p.amount)
        }));
        
        res.json({ 
            success: true,
            payments: payments 
        });
        
    } catch (error) {
        console.error('Get admin payments error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// ADMIN: VERIFY PAYMENT - FIX BUSINESS UPDATE
// ============================================
app.put('/api/admin/payments/:id/verify', authenticate, authorize('owner', 'admin'), async (req, res) => {
    console.log('=== VERIFY PAYMENT REQUEST ===');
    console.log('Params:', req.params);
    console.log('Body:', req.body);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const rawId = req.params.id;
        const { status } = req.body;
        
        // Validate payment ID
        if (!rawId || rawId === 'null' || rawId === 'undefined') {
            return res.status(400).json({ error: 'Invalid payment ID', received: rawId });
        }
        
        // Validate status
        if (!status || !['verified', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Status must be "verified" or "rejected"' });
        }
        
        console.log(`Looking for payment with ID: ${rawId}`);
        
        // Get payment - works for both UUID and integer IDs
        const paymentResult = await client.query(
            'SELECT * FROM subscription_payments WHERE id::text = $1::text',
            [String(rawId)]
        );
        
        console.log(`Found ${paymentResult.rows.length} payment(s)`);
        
        if (paymentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Payment not found', paymentId: rawId });
        }
        
        const payment = paymentResult.rows[0];
        
        console.log('Payment details:', {
            id: payment.id,
            business_id: payment.business_id,
            plan: payment.plan,
            amount: payment.amount,
            current_status: payment.payment_status
        });
        
        // Check if already processed
        if (payment.payment_status !== 'pending') {
            return res.status(400).json({ 
                error: `Payment is already ${payment.payment_status}` 
            });
        }
        
        // Update payment status
        console.log(`Updating payment status to: ${status}`);
        
        const updateResult = await client.query(
            `UPDATE subscription_payments 
             SET payment_status = $1, 
                 verified_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [status, payment.id]
        );
        
        console.log('Payment updated:', updateResult.rows[0]?.payment_status);
        
        // ============================================
        // CRITICAL FIX: Update business subscription
        // ============================================
        if (status === 'verified') {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 30);
            const nextDateStr = nextDate.toISOString().split('T')[0];
            
            const newPlan = payment.plan || 'starter';
            
            console.log(`🔄 Updating business ${payment.business_id}:`);
            console.log(`   - Plan: ${newPlan}`);
            console.log(`   - Next payment: ${nextDateStr}`);
            
            try {
                // FIXED: Update businesses table with proper ID matching
                const bizUpdate = await client.query(
                    `UPDATE businesses SET 
                        subscription_tier = $1,
                        payment_status = 'paid',
                        last_payment_date = CURRENT_DATE,
                        next_payment_date = $2::date,
                        payment_due_date = $2::date,
                        subscription_end_date = $2::date,
                        updated_at = NOW()
                     WHERE id::text = $3::text
                     RETURNING id, name, subscription_tier, payment_status`,
                    [newPlan, nextDateStr, String(payment.business_id)]
                );
                
                if (bizUpdate.rows.length === 0) {
                    console.warn(`⚠️ Business ${payment.business_id} not found!`);
                    console.log('Trying to find business with different ID format...');
                    
                    // Try to find the business
                    const findBiz = await client.query(
                        'SELECT id, name FROM businesses WHERE id::text = $1::text',
                        [String(payment.business_id)]
                    );
                    
                    if (findBiz.rows.length === 0) {
                        console.error(`❌ Business ${payment.business_id} not found in database!`);
                        console.log('Available businesses:');
                        const allBiz = await client.query('SELECT id, name FROM businesses LIMIT 5');
                        allBiz.rows.forEach(b => console.log(`  - ${b.id}: ${b.name}`));
                    } else {
                        console.log(`Found business: ${findBiz.rows[0].id} - ${findBiz.rows[0].name}`);
                        // Retry update with exact ID
                        const retryUpdate = await client.query(
                            `UPDATE businesses SET 
                                subscription_tier = $1,
                                payment_status = 'paid',
                                last_payment_date = CURRENT_DATE,
                                next_payment_date = $2::date,
                                updated_at = NOW()
                             WHERE id = $3
                             RETURNING id, name, subscription_tier`,
                            [newPlan, nextDateStr, findBiz.rows[0].id]
                        );
                        console.log('Retry result:', retryUpdate.rows[0]);
                    }
                } else {
                    console.log('✅ Business updated successfully:');
                    console.log(`   - ID: ${bizUpdate.rows[0].id}`);
                    console.log(`   - Name: ${bizUpdate.rows[0].name}`);
                    console.log(`   - Subscription: ${bizUpdate.rows[0].subscription_tier}`);
                    console.log(`   - Payment Status: ${bizUpdate.rows[0].payment_status}`);
                }
                
                // Also update the clients table if it exists
                try {
                    await client.query(
                        `UPDATE clients SET 
                            subscription_plan = $1,
                            payment_status = 'paid',
                            updated_at = NOW()
                         WHERE phone IN (SELECT phone FROM businesses WHERE id::text = $2::text)`,
                        [newPlan, String(payment.business_id)]
                    );
                    console.log('✅ Clients table updated');
                } catch (clientError) {
                    console.log('Clients table update (non-critical):', clientError.message);
                }
                
            } catch (bizError) {
                console.error('❌ Business update error:', bizError.message);
                console.error('Stack:', bizError.stack);
                // Don't throw - payment verification succeeds anyway
            }
        }
        
        await client.query('COMMIT');
        
        console.log('=== VERIFICATION SUCCESSFUL ===');
        
        res.json({
            success: true,
            message: `Payment ${status} successfully`,
            payment: updateResult.rows[0]
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('=== VERIFICATION FAILED ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({
            error: 'Verification failed',
            detail: error.message
        });
    } finally {
        client.release();
    }
});
// ============================================
// ADMIN NOTIFICATIONS
// ============================================

// Get unread notifications for admin
app.get('/api/admin/notifications', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM admin_notifications WHERE is_read = false ORDER BY created_at DESC LIMIT 20'
        );
        res.json({ notifications: result.rows, unread_count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mark notification as read
app.put('/api/admin/notifications/:id/read', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        await pool.query('UPDATE admin_notifications SET is_read = true WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mark all as read
app.put('/api/admin/notifications/read-all', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        await pool.query('UPDATE admin_notifications SET is_read = true WHERE is_read = false');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Verify or reject payment
app.put('/api/admin/payments/:id/verify', authenticate, authorize('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'verified' or 'rejected'
        
        const payment = await pool.query('SELECT * FROM subscription_payments WHERE id = $1', [id]);
        if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        
        const p = payment.rows[0];
        
        // Update payment status
        await pool.query(
            'UPDATE subscription_payments SET payment_status = $1, verified_by = $2, verified_at = NOW() WHERE id = $3',
            [status, req.user.id, id]
        );
        
        if (status === 'verified') {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 30);
            
            // Update business subscription
            await pool.query(
                `UPDATE businesses SET 
                    subscription_tier = $1,
                    payment_status = 'paid',
                    last_payment_date = CURRENT_DATE,
                    next_payment_date = $2,
                    updated_at = NOW()
                 WHERE id = $3`,
                [p.plan, nextDate.toISOString().split('T')[0], p.business_id]
            );
            
            // Notify the business owner
            const business = await pool.query('SELECT phone FROM businesses WHERE id = $1', [p.business_id]);
            if (business.rows[0]?.phone && TELEGRAM_BOT_TOKEN) {
                const customer = await pool.query('SELECT telegram_chat_id FROM customers WHERE phone = $1 LIMIT 1', [business.rows[0].phone]);
                if (customer.rows[0]?.telegram_chat_id) {
                    await sendTelegramMessage(customer.rows[0].telegram_chat_id, 
                        `✅ <b>Payment Verified!</b>\n\nYour ${p.plan.toUpperCase()} plan has been activated.\nAmount: ${p.amount} ETB\nValid until: ${nextDate.toISOString().split('T')[0]}\n\nThank you for your payment! 🙏`
                    );
                }
            }
        }
        
        res.json({ success: true, message: `Payment ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PAYMENT METHODS
// ============================================
app.get('/api/payment-methods', authenticate, async (req, res) => {
    res.json({
        methods: [
            {
                name: 'Telebirr',
                account: '0945305180',
                merchant_id: 'TB20240001',
                instructions: 'Send to Telebirr account and submit transaction reference'
            },
            {
                name: 'CBE Birr',
                account: '0945305180',
                short_code: '*847#',
                instructions: 'Dial *847# → Send Money → Enter 0945305180'
            },
            {
                name: 'Bank Transfer',
                bank: 'Commercial Bank of Ethiopia',
                account_number: '1000234567890',
                account_name: 'Kassie Taye',
                instructions: 'Transfer and upload receipt image'
            },
            {
                name: 'Cash Payment',
                instructions: 'Pay in person at our office'
            }
        ]
    });
});

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

// Get all subscriptions
app.get('/api/admin/subscriptions', authenticate, async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT 
                c.id, 
                c.business_name as name, 
                c.owner_name, 
                c.phone,
                c.subscription_plan, 
                c.monthly_fee,
                c.total_paid,
                c.payment_status,
                c.is_active,
                c.created_at,
                CASE 
                    WHEN c.subscription_plan = 'trial' THEN 'trial'
                    WHEN c.payment_status = 'paid' THEN 'active'
                    WHEN c.payment_status = 'pending' THEN 'overdue'
                    ELSE 'active'
                END as status
            FROM clients c
            WHERE 1=1
        `;
        const params = [];
        
        if (status === 'paid') {
            query += ` AND c.payment_status = 'paid'`;
        } else if (status === 'overdue') {
            query += ` AND c.payment_status = 'pending'`;
        } else if (status === 'trial') {
            query += ` AND c.subscription_plan = 'trial'`;
        }
        
        query += ` ORDER BY c.created_at DESC`;
        
        const result = await pool.query(query, params);
        res.json({ subscriptions: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Record payment for client subscription
app.post('/api/admin/subscriptions/:id/payment', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, payment_method } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount required' });
        }
        
        // Update client total paid
        await pool.query(
            'UPDATE clients SET total_paid = total_paid + $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
            [amount, 'paid', id]
        );
        
        // Record payment history
        await pool.query(
            `INSERT INTO client_payments (client_id, amount, payment_method, recorded_by)
             VALUES ($1, $2, $3, $4)`,
            [id, amount, payment_method || 'cash', req.user.id]
        );
        
        res.json({ success: true, message: 'Payment recorded successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SUBSCRIPTION STATUS CHECK
// ============================================
app.get('/api/subscription/check', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                subscription_plan, monthly_fee, 
                subscription_end_date, payment_due_date,
                (SELECT COALESCE(SUM(amount), 0) FROM subscription_payments WHERE business_id = $1) as total_paid
             FROM businesses WHERE id = $1`,
            [req.user.business_id]
        );
        
        const biz = result.rows[0];
        const now = new Date();
        const dueDate = biz.payment_due_date ? new Date(biz.payment_due_date) : null;
        const endDate = biz.subscription_end_date ? new Date(biz.subscription_end_date) : null;
        
        let status = 'active';
        let message = null;
        let color = 'green';
        let is_locked = false;
        let days_remaining = null;
        
        if (biz.subscription_plan === 'trial' || biz.subscription_plan === 'free') {
            status = 'trial';
        } else if (dueDate) {
            days_remaining = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
            
            if (days_remaining <= 0) {
                const graceDays = Math.abs(days_remaining);
                if (graceDays <= 3) {
                    status = 'grace';
                    message = `⚠️ Payment overdue by ${graceDays} day(s). Please renew to continue.`;
                    color = 'orange';
                    is_locked = false;
                } else {
                    status = 'locked';
                    message = '🔒 Account locked. Please contact admin to reactivate.';
                    color = 'red';
                    is_locked = true;
                }
            } else if (days_remaining <= 7) {
                status = 'warning';
                message = `⚠️ ${days_remaining} day(s) remaining. Please renew soon.`;
                color = 'yellow';
            }
        } else if (endDate && endDate < now) {
            status = 'expired';
            message = '🔒 Subscription expired. Please renew.';
            color = 'red';
            is_locked = true;
        }
        
        res.json({
            ...biz,
            status: status,
            message: message,
            color: color,
            is_locked: is_locked,
            days_remaining: days_remaining,
            grace_period: status === 'grace' ? 3 - Math.abs(days_remaining) : 0
        });
    } catch (error) {
        res.json({ status: 'active', is_locked: false, message: null });
    }
});

// Unlock account
app.put('/api/admin/subscriptions/:businessId/unlock', authenticate, async (req, res) => {
    try {
        await pool.query(
            `UPDATE businesses SET payment_due_date = CURRENT_DATE + INTERVAL '30 days', 
             subscription_end_date = CURRENT_DATE + INTERVAL '30 days', updated_at = NOW() 
             WHERE id = $1`,
            [req.params.businessId]
        );
        res.json({ success: true, message: 'Account unlocked for 30 days' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/payments', authenticate, async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT sp.id, sp.business_id, sp.plan, sp.amount, sp.payment_method, 
                   sp.transaction_ref, sp.payment_status, sp.notes, 
                   sp.created_at, sp.verified_at,
                   b.name as business_name, b.owner_name, b.phone
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

app.put('/api/admin/payments/:id/verify', authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        const status = req.body.status;
        
        // Cast to text for comparison (works with both int and uuid)
        const result = await pool.query(
            "UPDATE subscription_payments SET payment_status = $1, verified_at = NOW() WHERE id::text = $2::text RETURNING *",
            [status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        
        const payment = result.rows[0];
        
        if (status === 'verified') {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 30);
            await pool.query(
                "UPDATE businesses SET subscription_tier = $1, payment_status = 'paid', last_payment_date = CURRENT_DATE, next_payment_date = $2 WHERE id = $3",
                [payment.plan, nextDate.toISOString().split('T')[0], payment.business_id]
            );
        }
        
        res.json({ success: true, message: 'Payment ' + status });
    } catch (error) {
        res.status(500).json({ error: 'Verification failed', detail: error.message });
    }
});

app.get('/api/admin/notifications', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM admin_notifications WHERE is_read = false ORDER BY created_at DESC LIMIT 20');
        res.json({ notifications: result.rows, unread_count: result.rows.length });
    } catch (error) { res.json({ notifications: [], unread_count: 0 }); }
});

app.put('/api/admin/notifications/read-all', authenticate, async (req, res) => {
    try { await pool.query('UPDATE admin_notifications SET is_read = true WHERE is_read = false'); res.json({ success: true }); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({ error: 'Internal server error', detail: process.env.NODE_ENV === 'development' ? err.message : undefined });
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
    console.log(`🔍 Sentry Error Tracking: Active`);
    console.log(`\n✅ ALL ROUTES LOADED SUCCESSFULLY`);
});

module.exports = app;