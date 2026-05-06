require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// Database connection
const pool = new Pool({
    // host: process.env.DB_HOST || 'localhost',
    
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'smart_sme_manager',
    user: process.env.DB_USER || 'sme_admin',
    password: process.env.DB_PASSWORD || 'Kasu1122',
    ssl: {
        rejectUnauthorized: false
    }
});


// Test database connection
pool.query('SELECT NOW()')
    .then(() => console.log('Database connected'))
    .catch(err => console.error('Database connection error:', err));

// ============================================
// TEST ENDPOINT
// ============================================
app.get('/', (req, res) => {
    res.json({ 
        message: 'Smart SME Manager API Running',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// REGISTER
// ============================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { business_name, owner_name, phone, password } = req.body;

        // Validate
        if (!business_name || !owner_name || !phone || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Check existing
        const check = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: 'Phone already registered' });
        }

        // Create business
        const bizResult = await pool.query(
            'INSERT INTO businesses (name, owner_name, phone) VALUES ($1, $2, $3) RETURNING id',
            [business_name, owner_name, phone]
        );
        const businessId = bizResult.rows[0].id;

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        const userResult = await pool.query(
            'INSERT INTO users (business_id, full_name, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [businessId, owner_name, phone, hashedPassword, 'owner']
        );

        // Generate token
        const token = jwt.sign(
            { id: userResult.rows[0].id, business_id: businessId, role: 'owner' },
            process.env.JWT_SECRET || 'my-super-secret-key-2026',
            { expiresIn: '24h' }
        );

        res.status(201).json({ 
            success: true, 
            message: 'Business registered successfully',
            token, 
            business_id: businessId 
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// LOGIN
// ============================================
app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ error: 'Phone and password required' });
        }

        const result = await pool.query(
            `SELECT u.*, b.is_active as biz_active, b.name as business_name 
             FROM users u 
             JOIN businesses b ON u.business_id = b.id 
             WHERE u.phone = $1`,
            [phone]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({ error: 'Account deactivated' });
        }

        if (!user.biz_active) {
            return res.status(403).json({ error: 'Business account deactivated' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        const token = jwt.sign(
            { id: user.id, business_id: user.business_id, role: user.role },
            process.env.JWT_SECRET || 'my-super-secret-key-2026',
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
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MIDDLEWARE: Authentication
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

// ============================================
// GET PRODUCTS
// ============================================
app.get('/api/products', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM products WHERE business_id = $1 AND is_active = true ORDER BY name_translations',
            [req.user.business_id]
        );
        res.json({ products: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ADD PRODUCT
// ============================================
app.post('/api/products', authenticate, async (req, res) => {
    try {
        const { name_translations, barcode, cost_price, selling_price, current_stock, category_id } = req.body;

        if (!name_translations || !cost_price || !selling_price) {
            return res.status(400).json({ error: 'Name, cost price, and selling price required' });
        }

        const result = await pool.query(
            `INSERT INTO products (business_id, category_id, name_translations, barcode, cost_price, selling_price, current_stock) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [req.user.business_id, category_id || null, JSON.stringify(name_translations), barcode, cost_price, selling_price, current_stock || 0]
        );

        res.status(201).json({ success: true, product_id: result.rows[0].id });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MAKE SALE
// ============================================
app.post('/api/sales', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { items, customer_id, payment_method, amount_paid } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'No items in sale' });
        }

        // Calculate totals
        let subtotal = 0;
        const saleItems = [];

        for (const item of items) {
            const prodResult = await client.query(
                'SELECT * FROM products WHERE id = $1 AND business_id = $2',
                [item.product_id, req.user.business_id]
            );

            if (prodResult.rows.length === 0) {
                throw new Error(`Product not found: ${item.product_id}`);
            }

            const product = prodResult.rows[0];

            if (product.current_stock < item.quantity) {
                throw new Error(`Insufficient stock for product: ${product.name_translations}`);
            }

            const itemTotal = product.selling_price * item.quantity;
            subtotal += itemTotal;

            saleItems.push({
                product_id: product.id,
                quantity: item.quantity,
                unit_price: product.selling_price,
                cost_price: product.cost_price,
                total_price: itemTotal
            });
        }

        const discountAmount = 0;
        const taxAmount = subtotal * 0.15;
        const totalAmount = subtotal + taxAmount;

        // Insert sale
        const saleResult = await client.query(
            `INSERT INTO sales (business_id, user_id, customer_id, sale_number, subtotal, discount_amount, tax_amount, total_amount, amount_paid, payment_status, payment_method) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [req.user.business_id, req.user.id, customer_id || null, 'INV-' + Date.now(), subtotal, discountAmount, taxAmount, totalAmount, amount_paid || totalAmount, 'paid', payment_method || 'cash']
        );

        const saleId = saleResult.rows[0].id;

        // Insert sale items and update stock
        for (const item of saleItems) {
            await client.query(
                `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, total_price) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [saleId, item.product_id, item.quantity, item.unit_price, item.cost_price, item.total_price]
            );

            await client.query(
                'UPDATE products SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2',
                [item.quantity, item.product_id]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({ 
            success: true, 
            sale_id: saleId, 
            total_amount: totalAmount,
            items_sold: saleItems.length 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// ============================================
// DAILY REPORT
// ============================================
app.get('/api/reports/daily', authenticate, async (req, res) => {
    try {
        const today = req.query.date || new Date().toISOString().split('T')[0];

        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(tax_amount), 0) as total_tax,
                COALESCE(SUM(discount_amount), 0) as total_discounts,
                COUNT(DISTINCT customer_id) as unique_customers
             FROM sales 
             WHERE business_id = $1 AND sale_date = $2 AND payment_status = 'paid'`,
            [req.user.business_id, today]
        );

        const profitResult = await pool.query(
            `SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE s.business_id = $1 AND s.sale_date = $2`,
            [req.user.business_id, today]
        );

        res.json({
            date: today,
            ...result.rows[0],
            gross_profit: profitResult.rows[0].gross_profit
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`╔══════════════════════════════════════╗`);
    console.log(`║  SMART SME MANAGER API              ║`);
    console.log(`║  Server: http://localhost:${PORT}       ║`);
    console.log(`║  Started: ${new Date().toISOString()}  ║`);
    console.log(`╚══════════════════════════════════════╝`);
});
// ============================================
// GET CUSTOMERS
// ============================================
app.get('/api/customers', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM customers WHERE business_id = $1 ORDER BY full_name',
            [req.user.business_id]
        );
        res.json({ customers: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ADD CUSTOMER
// ============================================
app.post('/api/customers', authenticate, async (req, res) => {
    try {
        const { full_name, phone } = req.body;
        
        if (!full_name) {
            return res.status(400).json({ error: 'Name required' });
        }
        
        const result = await pool.query(
            'INSERT INTO customers (business_id, full_name, phone) VALUES ($1, $2, $3) RETURNING id',
            [req.user.business_id, full_name, phone]
        );
        
        res.status(201).json({ success: true, customer_id: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CATEGORIES
// ============================================
app.get('/api/categories', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM categories WHERE business_id = $1 ORDER BY name_translations',
            [req.user.business_id]
        );
        res.json({ categories: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/categories', authenticate, async (req, res) => {
    try {
        const { name_translations, icon } = req.body;
        const result = await pool.query(
            'INSERT INTO categories (business_id, name_translations, icon) VALUES ($1, $2, $3) RETURNING id',
            [req.user.business_id, JSON.stringify(name_translations), icon]
        );
        res.status(201).json({ success: true, category_id: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// STOCK ADJUSTMENT
// ============================================
app.post('/api/products/:id/adjust-stock', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, reason } = req.body;
        
        await pool.query(
            'UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 AND business_id = $3',
            [quantity, id, req.user.business_id]
        );
        
        await pool.query(
            `INSERT INTO stock_transactions (business_id, product_id, user_id, transaction_type, quantity, notes)
             VALUES ($1, $2, $3, 'adjustment', $4, $5)`,
            [req.user.business_id, id, req.user.id, quantity, reason]
        );
        
        res.json({ success: true, message: 'Stock adjusted' });
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

app.post('/api/expenses', authenticate, async (req, res) => {
    try {
        const { category, amount, description, expense_date } = req.body;
        const result = await pool.query(
            'INSERT INTO expenses (business_id, user_id, category, amount, description, expense_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [req.user.business_id, req.user.id, category, amount, description, expense_date]
        );
        res.status(201).json({ success: true, expense_id: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// TOP SELLERS
// ============================================
app.get('/api/reports/top-sellers', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.name_translations, SUM(si.quantity) as total_sold, SUM(si.total_price) as total_revenue
             FROM sale_items si
             JOIN products p ON si.product_id = p.id
             JOIN sales s ON si.sale_id = s.id
             WHERE s.business_id = $1
             GROUP BY p.id, p.name_translations
             ORDER BY total_sold DESC
             LIMIT 10`,
            [req.user.business_id]
        );
        res.json({ top_sellers: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CREDIT PAYMENT
// ============================================
app.post('/api/customers/:id/payment', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { id } = req.params;
        const { amount, payment_method } = req.body;
        
        // Get current balance
        const custResult = await client.query(
            'SELECT current_balance FROM customers WHERE id = $1 AND business_id = $2',
            [id, req.user.business_id]
        );
        
        if (custResult.rows.length === 0) {
            throw new Error('Customer not found');
        }
        
        const currentBalance = custResult.rows[0].current_balance;
        const newBalance = currentBalance - amount;
        
        // Update customer balance
        await client.query(
            'UPDATE customers SET current_balance = $1, updated_at = NOW() WHERE id = $2',
            [newBalance, id]
        );
        
        // Record payment
        await client.query(
            `INSERT INTO credit_transactions (business_id, customer_id, user_id, transaction_type, amount, balance_after, payment_method)
             VALUES ($1, $2, $3, 'payment', $4, $5, $6)`,
            [req.user.business_id, id, req.user.id, amount, newBalance, payment_method]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, new_balance: newBalance });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// ============================================
// ACTIVITY LOGS
// ============================================
app.get('/api/logs', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM audit_logs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50',
            [req.user.business_id]
        );
        res.json({ logs: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = app;