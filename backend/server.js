require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();

// ============================================
// CORS - FIXES FLUTTER CONNECTION ERROR
// ============================================
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
// HELPER: Get Ethiopian Date
// ============================================
function getEthiopianDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    
    let ethYear, ethMonth, ethDay;
    
    if (month > 9 || (month === 9 && day >= 11)) {
        ethYear = year + 7;
        ethMonth = month - 9;
        ethDay = day - 10;
    } else {
        ethYear = year + 8;
        ethMonth = month + 3;
        ethDay = day;
    }
    
    if (ethMonth > 12) ethMonth = 13;
    
    const ethMonths = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];
    const ethMonthsAm = ['መስከረም', 'ጥቅምት', 'ህዳር', 'ታህሳስ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዚያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];
    
    return {
        en: `${ethDay} ${ethMonths[ethMonth - 1]} ${ethYear}`,
        am: `${ethDay} ${ethMonthsAm[ethMonth - 1]} ${ethYear}`,
        day: ethDay,
        month: ethMonth,
        year: ethYear,
        monthNameEn: ethMonths[ethMonth - 1],
        monthNameAm: ethMonthsAm[ethMonth - 1]
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

// ============================================
// BUSINESS PROFILE & SETTINGS
// ============================================
app.get('/api/business/profile', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, owner_name, phone, email, city, tin_number, tax_type, tax_rate, show_tax_on_receipt, subscription_tier 
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
app.get('/api/customers', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM customers WHERE business_id = $1 AND is_active = true ORDER BY full_name',
            [req.user.business_id]
        );
        res.json({ customers: result.rows });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/customers', authenticate, async (req, res) => {
    try {
        const { full_name, phone, credit_limit, email, address } = req.body;
        if (!full_name) return res.status(400).json({ error: 'Name required' });
        
        const result = await pool.query(
            `INSERT INTO customers (business_id, full_name, phone, credit_limit, email, address) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [req.user.business_id, full_name, phone, credit_limit || 0, email || null, address || null]
        );
        res.status(201).json({ success: true, customer_id: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/customers/:id', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, phone, credit_limit, email, address } = req.body;
        
        const result = await pool.query(
            `UPDATE customers SET 
                full_name = COALESCE($1, full_name),
                phone = COALESCE($2, phone),
                credit_limit = COALESCE($3, credit_limit),
                email = COALESCE($4, email),
                address = COALESCE($5, address),
                updated_at = NOW()
             WHERE id = $6 AND business_id = $7 RETURNING *`,
            [full_name, phone, credit_limit, email, address, id, req.user.business_id]
        );
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
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

// Customer payments
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
// SALES (UPDATED with Tax Rate and Guarantor)
// ============================================
app.post('/api/sales', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { items, customer_id, payment_method, amount_paid, payment_status, guarantor_name, guarantor_phone, guarantor_id_number, tax_rate, subtotal: reqSubtotal, tax_amount: reqTaxAmount } = req.body;
        
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'No items in sale' });
        }
        
        // Get business tax settings
        const businessResult = await client.query(
            'SELECT tax_type, tax_rate, tin_number, show_tax_on_receipt, name FROM businesses WHERE id = $1',
            [req.user.business_id]
        );
        const business = businessResult.rows[0];
        const taxType = business?.tax_type || 'none';
        const businessTaxRate = business?.tax_rate || 0;
        
        // Use provided tax_rate or business default
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
        
        // Calculate tax
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
            
            // Record stock transaction
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
        
        // Record action log
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
// REPORTS (Updated with Tax and Ethiopian Date)
// ============================================
app.get('/api/reports/daily', authenticate, async (req, res) => {
    try {
        const today = req.query.date || new Date().toISOString().split('T')[0];
        
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_sales, 
                COALESCE(SUM(total_amount), 0) as total_revenue, 
                COALESCE(SUM(tax_amount), 0) as total_tax, 
                COUNT(DISTINCT customer_id) as unique_customers 
            FROM sales 
            WHERE business_id = $1 AND sale_date = $2 AND status = 'completed'
        `, [req.user.business_id, today]);
        
        const profitResult = await pool.query(`
            SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit 
            FROM sale_items si 
            JOIN sales s ON si.sale_id = s.id 
            WHERE s.business_id = $1 AND s.sale_date = $2 AND s.status = 'completed'
        `, [req.user.business_id, today]);
        
        res.json({ date: today, ...result.rows[0], gross_profit: profitResult.rows[0].gross_profit });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.get('/api/reports/monthly', authenticate, authorize('owner', 'manager'), async (req, res) => {
    try {
        const { month, year } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        
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
            AND EXTRACT(MONTH FROM sale_date) = $2 
            AND EXTRACT(YEAR FROM sale_date) = $3 
            AND status = 'completed'
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const profitResult = await pool.query(`
            SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit 
            FROM sale_items si 
            JOIN sales s ON si.sale_id = s.id 
            WHERE s.business_id = $1 
            AND EXTRACT(MONTH FROM s.sale_date) = $2 
            AND EXTRACT(YEAR FROM s.sale_date) = $3
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const expenseResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses 
            FROM expenses 
            WHERE business_id = $1 
            AND EXTRACT(MONTH FROM expense_date) = $2 
            AND EXTRACT(YEAR FROM expense_date) = $3
        `, [req.user.business_id, targetMonth, targetYear]);
        
        const totalExpenses = expenseResult.rows[0].total_expenses;
        const grossProfit = profitResult.rows[0].gross_profit;
        res.json({ 
            period: 'monthly', 
            month: parseInt(targetMonth), 
            year: parseInt(targetYear), 
            ...result.rows[0], 
            gross_profit: grossProfit, 
            total_expenses: totalExpenses, 
            net_profit: grossProfit - totalExpenses 
        });
    } catch (error) { 
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
        
        const totalExpenses = expenseResult.rows[0].total_expenses;
        const grossProfit = profitResult.rows[0].gross_profit;
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
        
        const totalExpenses = expenseResult.rows[0].total_expenses;
        const grossProfit = profitResult.rows[0].gross_profit;
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
        
        const totalExpenses = expenseResult.rows[0].total_expenses;
        const grossProfit = profitResult.rows[0].gross_profit;
        res.json({ 
            period: 'custom', 
            from, to, 
            ...result.rows[0], 
            gross_profit: grossProfit, 
            total_expenses: totalExpenses, 
            net_profit: grossProfit - totalExpenses 
        });
    } catch (error) { 
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
        
        res.json({ 
            today: todayResult.rows[0], 
            this_month: monthResult.rows[0], 
            this_year: yearResult.rows[0], 
            all_time: totalResult.rows[0] 
        });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// Debt Aging Report
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
        
        // Record stock transaction
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
// DAILY CASH-OUT (Z-REPORT)
// ============================================
app.get('/api/cashout/status', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await pool.query(
            'SELECT * FROM daily_cashouts WHERE business_id = $1 AND cashout_date = $2',
            [req.user.business_id, today]
        );
        
        const isClosed = result.rows.length > 0 && result.rows[0].is_closed;
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
        
        const summary = salesResult.rows[0];
        summary.total_expenses = parseFloat(expensesResult.rows[0].total_expenses || 0);
        summary.opening_cash_balance = openingBalance;
        summary.expected_cash_balance = openingBalance + (summary.cash_sales || 0) - summary.total_expenses;
        
        res.json({ success: true, summary });
    } catch (error) {
        console.error('Cashout summary error:', error);
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

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 API URL: ${process.env.API_URL || 'https://smart-sme-api.onrender.com'}`);
    console.log(`📅 Ethiopian Calendar Support: Enabled`);
    console.log(`💰 Tax System: Optional (VAT/TOT/None)`);
});

module.exports = app;