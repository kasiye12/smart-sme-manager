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
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use(express.json());

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 3,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
    console.error('Unexpected pool error:', err);
});

// Test database connection
pool.query('SELECT NOW()')
    .then(res => console.log('✅ Database connected at:', res.rows[0].now))
    .catch(err => console.error('❌ Database connection failed:', err.message));

// Health check
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
        console.error('Register error:', error.message);
        res.status(500).json({ 
            error: 'Registration failed',
            detail: error.message,
            code: error.code 
        });
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
        
        res.json({ 
            success: true, token, 
            user: { id: user.id, name: user.full_name, business_name: user.business_name, role: user.role } 
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', detail: error.message });
    }
});

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

// ============================================
// PRODUCTS
// ============================================
app.get('/api/products', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM products WHERE business_id = $1 AND is_active = true',
            [req.user.business_id]
        );
        res.json({ products: result.rows });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/products', authenticate, async (req, res) => {
    try {
        const { name_translations, barcode, cost_price, selling_price, current_stock } = req.body;
        if (!name_translations || !cost_price || !selling_price) {
            return res.status(400).json({ error: 'Name, cost price, and selling price required' });
        }
        const result = await pool.query(
            `INSERT INTO products (business_id, name_translations, barcode, cost_price, selling_price, current_stock) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [req.user.business_id, JSON.stringify(name_translations), barcode, cost_price, selling_price, current_stock || 0]
        );
        res.status(201).json({ success: true, product_id: result.rows[0].id });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// ============================================
// CUSTOMERS
// ============================================
app.get('/api/customers', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers WHERE business_id = $1 ORDER BY full_name', [req.user.business_id]);
        res.json({ customers: result.rows });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/customers', authenticate, async (req, res) => {
    try {
        const { full_name, phone } = req.body;
        if (!full_name) return res.status(400).json({ error: 'Name required' });
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
// SALES
// ============================================
app.post('/api/sales', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { items, customer_id, payment_method, amount_paid } = req.body;
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'No items in sale' });
        }
        let subtotal = 0;
        const saleItems = [];
        for (const item of items) {
            const prodResult = await client.query(
                'SELECT * FROM products WHERE id = $1 AND business_id = $2',
                [item.product_id, req.user.business_id]
            );
            if (prodResult.rows.length === 0) throw new Error('Product not found');
            const product = prodResult.rows[0];
            if (product.current_stock < item.quantity) throw new Error('Insufficient stock');
            const itemTotal = product.selling_price * item.quantity;
            subtotal += itemTotal;
            saleItems.push({
                product_id: product.id, quantity: item.quantity,
                unit_price: product.selling_price, cost_price: product.cost_price, total_price: itemTotal
            });
        }
        const taxAmount = parseFloat((subtotal * 0.15).toFixed(2));
        const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));
        const saleNumber = 'INV-' + Date.now();
        
        const saleResult = await client.query(
            `INSERT INTO sales (business_id, user_id, customer_id, sale_number, subtotal, discount_amount, tax_amount, total_amount, amount_paid, payment_status, payment_method) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [req.user.business_id, req.user.id, customer_id || null, saleNumber, subtotal, 0, taxAmount, totalAmount, amount_paid || totalAmount, 'paid', payment_method || 'cash']
        );
        
        const saleId = saleResult.rows[0].id;
        for (const item of saleItems) {
            await client.query(
                'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, total_price) VALUES ($1, $2, $3, $4, $5, $6)',
                [saleId, item.product_id, item.quantity, item.unit_price, item.cost_price, item.total_price]
            );
            await client.query('UPDATE products SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
        }
        await client.query('COMMIT');
        res.status(201).json({ 
            success: true, sale_id: saleId, sale_number: saleNumber,
            total_amount: totalAmount, items_sold: saleItems.length 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally { 
        client.release(); 
    }
});

// ============================================
// REPORTS
// ============================================
app.get('/api/reports/daily', authenticate, async (req, res) => {
    try {
        const today = req.query.date || new Date().toISOString().split('T')[0];
        const result = await pool.query(
            `SELECT COUNT(*) as total_sales, COALESCE(SUM(total_amount), 0) as total_revenue, 
                    COALESCE(SUM(tax_amount), 0) as total_tax, COUNT(DISTINCT customer_id) as unique_customers
             FROM sales WHERE business_id = $1 AND sale_date = $2`,
            [req.user.business_id, today]
        );
        const profitResult = await pool.query(
            `SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit
             FROM sale_items si JOIN sales s ON si.sale_id = s.id
             WHERE s.business_id = $1 AND s.sale_date = $2`,
            [req.user.business_id, today]
        );
        res.json({ date: today, ...result.rows[0], gross_profit: profitResult.rows[0].gross_profit });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// ============================================
// EXPENSES
// ============================================
app.get('/api/expenses', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expenses WHERE business_id = $1 ORDER BY expense_date DESC LIMIT 50', [req.user.business_id]);
        res.json({ expenses: result.rows });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/expenses', authenticate, async (req, res) => {
    try {
        const { category, amount, description, expense_date } = req.body;
        if (!category || !amount) {
            return res.status(400).json({ error: 'Category and amount required' });
        }
        const result = await pool.query(
            'INSERT INTO expenses (business_id, user_id, category, amount, description, expense_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [req.user.business_id, req.user.id, category, amount, description, expense_date || new Date().toISOString().split('T')[0]]
        );
        res.status(201).json({ success: true, expense_id: result.rows[0].id });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// ============================================
// STOCK ADJUSTMENT
// ============================================
app.post('/api/inventory/adjust', authenticate, async (req, res) => {
    try {
        const { product_id, adjustment_type, quantity, direction, reason } = req.body;
        
        if (!product_id || !quantity || !direction) {
            return res.status(400).json({ error: 'Product, quantity, and direction required' });
        }
        
        // Get product
        const product = await pool.query(
            'SELECT * FROM products WHERE id = $1 AND business_id = $2',
            [product_id, req.user.business_id]
        );
        
        if (product.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        // Update stock
        const newStock = direction === 'in' 
            ? product.rows[0].current_stock + parseInt(quantity)
            : product.rows[0].current_stock - parseInt(quantity);
            
        if (newStock < 0) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }
        
        await pool.query(
            'UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2',
            [newStock, product_id]
        );
        
        // Log adjustment
        await pool.query(
            `INSERT INTO stock_adjustments (business_id, product_id, user_id, adjustment_type, quantity, direction, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [req.user.business_id, product_id, req.user.id, adjustment_type || 'correction', quantity, direction, reason]
        );
        
        // Record stock transaction
        await pool.query(
            `INSERT INTO stock_transactions (business_id, product_id, user_id, transaction_type, quantity, notes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.user.business_id, product_id, req.user.id, direction === 'in' ? 'adjustment' : adjustment_type || 'adjustment', quantity, reason]
        );
        
        res.json({ 
            success: true, 
            message: `Stock ${direction === 'in' ? 'increased' : 'decreased'} by ${quantity}`,
            new_stock: newStock
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET STOCK ADJUSTMENTS
app.get('/api/inventory/adjustments', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT sa.*, p.name_translations as product_name
             FROM stock_adjustments sa
             JOIN products p ON sa.product_id = p.id
             WHERE sa.business_id = $1
             ORDER BY sa.created_at DESC
             LIMIT 50`,
            [req.user.business_id]
        );
        res.json({ adjustments: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATE PRODUCT (Full update with unit)
app.put('/api/products/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { name_translations, barcode, cost_price, selling_price, current_stock, unit, category_id } = req.body;
        
        const result = await pool.query(
            `UPDATE products SET 
                name_translations = COALESCE($1, name_translations),
                barcode = COALESCE($2, barcode),
                cost_price = COALESCE($3, cost_price),
                selling_price = COALESCE($4, selling_price),
                current_stock = COALESCE($5, current_stock),
                unit = COALESCE($6, unit),
                category_id = COALESCE($7, category_id),
                updated_at = NOW()
             WHERE id = $8 AND business_id = $9
             RETURNING *`,
            [
                name_translations ? JSON.stringify(name_translations) : null,
                barcode,
                cost_price,
                selling_price,
                current_stock,
                unit,
                category_id,
                id,
                req.user.business_id
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        res.json({ success: true, product: result.rows[0] });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// MONTHLY REPORT
// ============================================
app.get('/api/reports/monthly', authenticate, async (req, res) => {
    try {
        const { month, year } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(tax_amount), 0) as total_tax,
                COALESCE(SUM(discount_amount), 0) as total_discounts,
                COUNT(DISTINCT customer_id) as unique_customers,
                COUNT(DISTINCT sale_date) as active_days
             FROM sales 
             WHERE business_id = $1 
             AND EXTRACT(MONTH FROM sale_date) = $2 
             AND EXTRACT(YEAR FROM sale_date) = $3`,
            [req.user.business_id, targetMonth, targetYear]
        );
        
        // Monthly profit
        const profitResult = await pool.query(
            `SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit
             FROM sale_items si JOIN sales s ON si.sale_id = s.id
             WHERE s.business_id = $1 
             AND EXTRACT(MONTH FROM s.sale_date) = $2 
             AND EXTRACT(YEAR FROM s.sale_date) = $3`,
            [req.user.business_id, targetMonth, targetYear]
        );
        
        // Monthly expenses
        const expenseResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total_expenses
             FROM expenses 
             WHERE business_id = $1 
             AND EXTRACT(MONTH FROM expense_date) = $2 
             AND EXTRACT(YEAR FROM expense_date) = $3`,
            [req.user.business_id, targetMonth, targetYear]
        );
        
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

// ============================================
// YEARLY REPORT
// ============================================
app.get('/api/reports/yearly', authenticate, async (req, res) => {
    try {
        const { year } = req.query;
        const targetYear = year || new Date().getFullYear();
        
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(tax_amount), 0) as total_tax,
                COUNT(DISTINCT customer_id) as unique_customers,
                COUNT(DISTINCT EXTRACT(MONTH FROM sale_date)) as active_months
             FROM sales 
             WHERE business_id = $1 
             AND EXTRACT(YEAR FROM sale_date) = $2`,
            [req.user.business_id, targetYear]
        );
        
        const profitResult = await pool.query(
            `SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit
             FROM sale_items si JOIN sales s ON si.sale_id = s.id
             WHERE s.business_id = $1 
             AND EXTRACT(YEAR FROM s.sale_date) = $2`,
            [req.user.business_id, targetYear]
        );
        
        const expenseResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total_expenses
             FROM expenses 
             WHERE business_id = $1 
             AND EXTRACT(YEAR FROM expense_date) = $2`,
            [req.user.business_id, targetYear]
        );
        
        // Monthly breakdown
        const monthlyBreakdown = await pool.query(
            `SELECT 
                EXTRACT(MONTH FROM sale_date) as month,
                COUNT(*) as sales_count,
                COALESCE(SUM(total_amount), 0) as revenue
             FROM sales 
             WHERE business_id = $1 
             AND EXTRACT(YEAR FROM sale_date) = $2
             GROUP BY EXTRACT(MONTH FROM sale_date)
             ORDER BY month`,
            [req.user.business_id, targetYear]
        );
        
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

// ============================================
// QUARTERLY REPORT
// ============================================
app.get('/api/reports/quarterly', authenticate, async (req, res) => {
    try {
        const { quarter, year } = req.query;
        const targetQuarter = quarter || Math.ceil((new Date().getMonth() + 1) / 3);
        const targetYear = year || new Date().getFullYear();
        
        const startMonth = (targetQuarter - 1) * 3 + 1;
        const endMonth = startMonth + 2;
        
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(tax_amount), 0) as total_tax,
                COUNT(DISTINCT customer_id) as unique_customers,
                COUNT(DISTINCT sale_date) as active_days
             FROM sales 
             WHERE business_id = $1 
             AND EXTRACT(MONTH FROM sale_date) BETWEEN $2 AND $3
             AND EXTRACT(YEAR FROM sale_date) = $4`,
            [req.user.business_id, startMonth, endMonth, targetYear]
        );
        
        const profitResult = await pool.query(
            `SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit
             FROM sale_items si JOIN sales s ON si.sale_id = s.id
             WHERE s.business_id = $1 
             AND EXTRACT(MONTH FROM s.sale_date) BETWEEN $2 AND $3
             AND EXTRACT(YEAR FROM s.sale_date) = $4`,
            [req.user.business_id, startMonth, endMonth, targetYear]
        );
        
        const expenseResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total_expenses
             FROM expenses 
             WHERE business_id = $1 
             AND EXTRACT(MONTH FROM expense_date) BETWEEN $2 AND $3
             AND EXTRACT(YEAR FROM expense_date) = $4`,
            [req.user.business_id, startMonth, endMonth, targetYear]
        );
        
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

// ============================================
// SALES SUMMARY (for dashboard stats)
// ============================================
app.get('/api/reports/summary', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = new Date().getMonth() + 1;
        const thisYear = new Date().getFullYear();
        
        // Today
        const todayResult = await pool.query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
             FROM sales WHERE business_id = $1 AND sale_date = $2`,
            [req.user.business_id, today]
        );
        
        // This month
        const monthResult = await pool.query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
             FROM sales WHERE business_id = $1 
             AND EXTRACT(MONTH FROM sale_date) = $2 AND EXTRACT(YEAR FROM sale_date) = $3`,
            [req.user.business_id, thisMonth, thisYear]
        );
        
        // This year
        const yearResult = await pool.query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
             FROM sales WHERE business_id = $1 AND EXTRACT(YEAR FROM sale_date) = $2`,
            [req.user.business_id, thisYear]
        );
        
        // Totals
        const totalResult = await pool.query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
             FROM sales WHERE business_id = $1`,
            [req.user.business_id]
        );
        
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
// ============================================
// CUSTOM DATE RANGE REPORT
// ============================================
app.get('/api/reports/custom', authenticate, async (req, res) => {
    try {
        const { from, to } = req.query;
        
        if (!from || !to) {
            return res.status(400).json({ error: 'From and To dates required' });
        }
        
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(tax_amount), 0) as total_tax,
                COALESCE(SUM(discount_amount), 0) as total_discounts,
                COUNT(DISTINCT customer_id) as unique_customers,
                COUNT(DISTINCT sale_date) as active_days
             FROM sales 
             WHERE business_id = $1 
             AND sale_date BETWEEN $2 AND $3`,
            [req.user.business_id, from, to]
        );
        
        const profitResult = await pool.query(
            `SELECT COALESCE(SUM(si.profit_amount), 0) as gross_profit
             FROM sale_items si JOIN sales s ON si.sale_id = s.id
             WHERE s.business_id = $1 AND s.sale_date BETWEEN $2 AND $3`,
            [req.user.business_id, from, to]
        );
        
        const expenseResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total_expenses
             FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3`,
            [req.user.business_id, from, to]
        );
        
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
// ============================================
// VOID SALE
// ============================================
app.post('/api/sales/:id/void', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { reason } = req.body;
        
        // Get sale
        const sale = await client.query(
            'SELECT * FROM sales WHERE id = $1 AND business_id = $2',
            [id, req.user.business_id]
        );
        
        if (sale.rows.length === 0) {
            return res.status(404).json({ error: 'Sale not found' });
        }
        
        if (sale.rows[0].status === 'voided') {
            return res.status(400).json({ error: 'Sale already voided' });
        }
        
        // Update sale status
        await client.query(
            "UPDATE sales SET status = 'voided', void_reason = $1, updated_at = NOW() WHERE id = $2",
            [reason || 'No reason provided', id]
        );
        
        // Restore stock
        const items = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [id]);
        for (const item of items.rows) {
            await client.query(
                'UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2',
                [item.quantity, item.product_id]
            );
        }
        
        // If credit sale, reverse customer balance
        if (sale.rows[0].customer_id && sale.rows[0].payment_status === 'credit') {
            await client.query(
                'UPDATE customers SET current_balance = current_balance - $1, updated_at = NOW() WHERE id = $2',
                [sale.rows[0].total_amount - sale.rows[0].amount_paid, sale.rows[0].customer_id]
            );
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Sale voided successfully' });
        
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// GET ALL SALES (for void/review)
app.get('/api/sales', authenticate, async (req, res) => {
    try {
        const limit = req.query.limit || 50;
        const result = await pool.query(
            `SELECT s.*, c.full_name as customer_name
             FROM sales s LEFT JOIN customers c ON s.customer_id = c.id
             WHERE s.business_id = $1
             ORDER BY s.created_at DESC LIMIT $2`,
            [req.user.business_id, limit]
        );
        res.json({ sales: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// STOCK ADJUSTMENT
// ============================================
app.post('/api/inventory/adjust', authenticate, async (req, res) => {
    try {
        const { product_id, adjustment_type, quantity, direction, reason } = req.body;
        
        if (!product_id || !quantity || !direction) {
            return res.status(400).json({ error: 'Product, quantity, and direction required' });
        }
        
        const product = await pool.query(
            'SELECT * FROM products WHERE id = $1 AND business_id = $2',
            [product_id, req.user.business_id]
        );
        
        if (product.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        const newStock = direction === 'in' 
            ? product.rows[0].current_stock + parseInt(quantity)
            : product.rows[0].current_stock - parseInt(quantity);
            
        if (newStock < 0) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }
        
        await pool.query(
            'UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2',
            [newStock, product_id]
        );
        
        await pool.query(
            `INSERT INTO stock_adjustments (business_id, product_id, user_id, adjustment_type, quantity, direction, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [req.user.business_id, product_id, req.user.id, adjustment_type || 'correction', quantity, direction, reason]
        );
        
        res.json({ success: true, message: `Stock ${direction === 'in' ? 'increased' : 'decreased'} by ${quantity}`, new_stock: newStock });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// RECORD CUSTOMER PAYMENT
// ============================================
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

// GET CUSTOMER PAYMENT HISTORY
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
// UPDATE CUSTOMER (with credit limit)
app.put('/api/customers/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, phone, credit_limit } = req.body;
        
        const result = await pool.query(
            `UPDATE customers SET 
                full_name = COALESCE($1, full_name),
                phone = COALESCE($2, phone),
                credit_limit = COALESCE($3, credit_limit),
                updated_at = NOW()
             WHERE id = $4 AND business_id = $5
             RETURNING *`,
            [full_name, phone, credit_limit, id, req.user.business_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        res.json({ success: true, customer: result.rows[0], message: 'Customer updated' });
        
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
    console.log(`📍 API URL: https://smart-sme-api.onrender.com`);
});

module.exports = app;