-- ============================================
-- SMART SME MANAGER - COMPLETE DATABASE SCHEMA
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- BUSINESSES (Updated with Tax & TIN)
-- ============================================
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    owner_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(150),
    city VARCHAR(100),
    
    -- Tax Settings (Optional for small businesses)
    tax_type VARCHAR(20) DEFAULT 'none',  -- 'none', 'vat_15', 'tot_2', 'custom'
    tax_rate DECIMAL(5,2) DEFAULT 0,       -- For 'custom' tax type
    tin_number VARCHAR(20),                 -- Tax Identification Number (optional)
    show_tax_on_receipt BOOLEAN DEFAULT false,
    
    -- Subscription & Status
    subscription_tier VARCHAR(20) DEFAULT 'free',
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- USERS (with PIN for cashiers)
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    pin_code VARCHAR(6),                    -- For cashier quick login
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CATEGORIES
-- ============================================
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name_translations JSONB NOT NULL DEFAULT '{}',  -- {'en': 'Drinks', 'am': 'መጠጦች'}
    icon VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PRODUCTS (Enhanced with Unit Conversion & Expiry)
-- ============================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id),
    
    -- Basic Info
    name_translations JSONB NOT NULL DEFAULT '{}',  -- {'en': 'Coke', 'am': 'ኮካ ኮላ'}
    barcode VARCHAR(100),
    
    -- Unit & Conversion
    base_unit VARCHAR(20) DEFAULT 'piece',   -- 'piece', 'kg', 'liter', 'box', 'meter', 'dozen'
    bulk_unit VARCHAR(20),                    -- 'box', 'pack', 'carton'
    bulk_quantity DECIMAL(10,3) DEFAULT 1,    -- e.g., 12 pieces per box
    conversion_rate DECIMAL(10,3) DEFAULT 1,  -- How many base units in bulk unit
    
    -- Pricing & Stock
    cost_price DECIMAL(12,2) NOT NULL,
    selling_price DECIMAL(12,2) NOT NULL,
    current_stock INTEGER DEFAULT 0,
    min_stock_level INTEGER DEFAULT 5,
    
    -- Expiration Tracking (for groceries, medicine)
    track_expiry BOOLEAN DEFAULT false,
    manufactured_date DATE,
    expiry_date DATE,
    batch_number VARCHAR(50),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(business_id, barcode)
);

-- ============================================
-- CUSTOMERS (Enhanced with Credit Features)
-- ============================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(150),
    address TEXT,
    
    -- Credit Settings
    credit_limit DECIMAL(12,2) DEFAULT 0,
    current_balance DECIMAL(12,2) DEFAULT 0,
    credit_score INTEGER DEFAULT 0,           -- For credit risk assessment
    
    -- Additional Info
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CREDIT TRANSACTIONS (Enhanced with Guarantor)
-- ============================================
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    sale_id UUID REFERENCES sales(id),
    
    -- Transaction Details
    transaction_type VARCHAR(20) NOT NULL,    -- 'credit', 'payment', 'adjustment'
    amount DECIMAL(12,2) NOT NULL,
    balance_after DECIMAL(12,2) NOT NULL,
    
    -- Guarantor (Wass) for credit sales
    guarantor_name VARCHAR(150),
    guarantor_phone VARCHAR(20),
    guarantor_id_number VARCHAR(50),
    
    -- Due Date for Credit (days)
    due_days INTEGER DEFAULT 30,               -- Payment due in X days
    due_date DATE,                             -- Calculated due date
    paid_at TIMESTAMPTZ,                       -- When payment was completed
    
    -- Created by
    user_id UUID NOT NULL REFERENCES users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SALES (Enhanced with Ethiopian Date & Receipt)
-- ============================================
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    customer_id UUID REFERENCES customers(id),
    
    -- Receipt Info
    sale_number VARCHAR(20) NOT NULL UNIQUE,
    sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
    ethiopian_date VARCHAR(50),                -- Store Ethiopian date for reports
    
    -- Financials
    subtotal DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    amount_paid DECIMAL(12,2) DEFAULT 0,
    
    -- Payment
    payment_status VARCHAR(20) DEFAULT 'paid', -- 'paid', 'credit', 'partial'
    payment_method VARCHAR(30),                -- 'cash', 'telebirr', 'cbe', 'bank', 'credit'
    
    -- Void/Cancellation
    status VARCHAR(20) DEFAULT 'completed',    -- 'completed', 'voided', 'refunded'
    void_reason TEXT,
    voided_by UUID REFERENCES users(id),
    voided_at TIMESTAMPTZ,
    
    -- Sync for offline
    is_synced BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SALE ITEMS
-- ============================================
CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    
    -- Quantity & Pricing
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    cost_price DECIMAL(12,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    
    -- Bulk info (if sold in bulk)
    used_bulk_unit BOOLEAN DEFAULT false,
    bulk_quantity DECIMAL(10,3),
    
    -- Derived profit
    profit_amount DECIMAL(12,2) GENERATED ALWAYS AS (total_price - (quantity * cost_price)) STORED,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- EXPENSES
-- ============================================
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    category VARCHAR(50) NOT NULL,             -- 'rent', 'salary', 'electricity', 'water', 'other'
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    expense_date DATE NOT NULL,
    receipt_image VARCHAR(255),                -- Path to receipt image
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- STOCK ADJUSTMENTS (For inventory tracking)
-- ============================================
CREATE TABLE stock_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    adjustment_type VARCHAR(20) NOT NULL,      -- 'correction', 'damage', 'return', 'expiry'
    quantity INTEGER NOT NULL,
    direction VARCHAR(10) NOT NULL,            -- 'in', 'out'
    reason TEXT,
    
    -- For expiry adjustments
    old_expiry_date DATE,
    new_expiry_date DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- STOCK TRANSACTIONS (For audit trail)
-- ============================================
CREATE TABLE stock_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    transaction_type VARCHAR(20) NOT NULL,     -- 'sale', 'purchase', 'adjustment', 'return'
    quantity INTEGER NOT NULL,
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    reference_id UUID,                         -- sale_id or adjustment_id
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DAILY CASH-OUT (Z-Report)
-- ============================================
CREATE TABLE daily_cashouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    cashout_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Totals
    total_sales DECIMAL(12,2) NOT NULL,
    total_cash_sales DECIMAL(12,2) DEFAULT 0,
    total_credit_sales DECIMAL(12,2) DEFAULT 0,
    total_expenses DECIMAL(12,2) DEFAULT 0,
    total_cash_payments_received DECIMAL(12,2) DEFAULT 0,
    
    -- Expected cash
    opening_cash_balance DECIMAL(12,2) DEFAULT 0,
    expected_cash_balance DECIMAL(12,2) DEFAULT 0,
    actual_cash_balance DECIMAL(12,2),
    
    -- Difference (over/short)
    cash_difference DECIMAL(12,2) DEFAULT 0,
    
    notes TEXT,
    is_closed BOOLEAN DEFAULT false,
    closed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(business_id, cashout_date)
);

-- ============================================
-- ACTION LOGS (For audit & security)
-- ============================================
CREATE TABLE action_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    action_type VARCHAR(50) NOT NULL,          -- 'sale', 'void_sale', 'add_product', 'edit_product', etc.
    entity_type VARCHAR(50),                   -- 'product', 'customer', 'sale', 'user'
    entity_id UUID,
    details JSONB,                             -- Store before/after values
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DEVICES (For offline sync)
-- ============================================
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    device_id VARCHAR(100) NOT NULL UNIQUE,
    device_name VARCHAR(100),
    device_type VARCHAR(20),                   -- 'mobile', 'tablet', 'web'
    last_sync_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SYNC LOGS (For offline data sync)
-- ============================================
CREATE TABLE sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    device_id VARCHAR(100) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    operation VARCHAR(10) NOT NULL,            -- 'insert', 'update', 'delete'
    sync_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'synced', 'failed'
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ
);

-- ============================================
-- INDEXES (For performance)
-- ============================================

-- Business indexes
CREATE INDEX idx_businesses_phone ON businesses(phone);
CREATE INDEX idx_businesses_tin ON businesses(tin_number);

-- User indexes
CREATE INDEX idx_users_business ON users(business_id);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);

-- Product indexes
CREATE INDEX idx_products_business ON products(business_id);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_expiry ON products(expiry_date) WHERE track_expiry = true;

-- Customer indexes
CREATE INDEX idx_customers_business ON customers(business_id);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_balance ON customers(current_balance) WHERE current_balance > 0;

-- Sale indexes
CREATE INDEX idx_sales_business_date ON sales(business_id, sale_date);
CREATE INDEX idx_sales_number ON sales(sale_number);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_status ON sales(status);

-- Sale items indexes
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

-- Credit transaction indexes
CREATE INDEX idx_credit_customer ON credit_transactions(customer_id);
CREATE INDEX idx_credit_created ON credit_transactions(created_at);
CREATE INDEX idx_credit_due_date ON credit_transactions(due_date) WHERE due_date IS NOT NULL;

-- Expense indexes
CREATE INDEX idx_expenses_business_date ON expenses(business_id, expense_date);
CREATE INDEX idx_expenses_category ON expenses(category);

-- Stock indexes
CREATE INDEX idx_stock_transactions_product ON stock_transactions(product_id);
CREATE INDEX idx_stock_transactions_date ON stock_transactions(created_at);

-- Action logs indexes
CREATE INDEX idx_action_logs_business ON action_logs(business_id);
CREATE INDEX idx_action_logs_user ON action_logs(user_id);
CREATE INDEX idx_action_logs_created ON action_logs(created_at);

-- Daily cashout indexes
CREATE INDEX idx_cashouts_business_date ON daily_cashouts(business_id, cashout_date);

-- ============================================
-- TRIGGERS (For auto-updating timestamps)
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables with updated_at
CREATE TRIGGER update_businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_credit_transactions_updated_at BEFORE UPDATE ON credit_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_daily_cashouts_updated_at BEFORE UPDATE ON daily_cashouts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Auto-update customer balance
-- ============================================
CREATE OR REPLACE FUNCTION update_customer_balance()
RETURNS TRIGGER AS $$
BEGIN
    -- For credit sales
    IF NEW.transaction_type = 'credit' THEN
        UPDATE customers 
        SET current_balance = current_balance + NEW.amount,
            updated_at = NOW()
        WHERE id = NEW.customer_id;
    
    -- For payments
    ELSIF NEW.transaction_type = 'payment' THEN
        UPDATE customers 
        SET current_balance = current_balance - NEW.amount,
            updated_at = NOW()
        WHERE id = NEW.customer_id;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_customer_balance_on_transaction
AFTER INSERT ON credit_transactions
FOR EACH ROW
EXECUTE FUNCTION update_customer_balance();

-- ============================================
-- FUNCTION: Auto-record stock transactions
-- ============================================
CREATE OR REPLACE FUNCTION record_stock_transaction()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.current_stock != NEW.current_stock THEN
        INSERT INTO stock_transactions (
            business_id, product_id, user_id, transaction_type,
            quantity, quantity_before, quantity_after, notes
        ) VALUES (
            NEW.business_id, NEW.id, COALESCE(current_setting('app.current_user_id')::UUID, NULL),
            'adjustment',
            ABS(NEW.current_stock - OLD.current_stock),
            OLD.current_stock, NEW.current_stock,
            'Stock adjusted via product update'
        );
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER record_stock_change
AFTER UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION record_stock_transaction();

-- ============================================
-- FUNCTION: Auto-calculate due date for credit
-- ============================================
CREATE OR REPLACE FUNCTION set_credit_due_date()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.transaction_type = 'credit' AND NEW.due_days IS NOT NULL THEN
        NEW.due_date := CURRENT_DATE + (NEW.due_days || ' days')::INTERVAL;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER set_credit_due_date_before_insert
BEFORE INSERT ON credit_transactions
FOR EACH ROW
EXECUTE FUNCTION set_credit_due_date();

-- ============================================
-- VIEW: Debt Aging Report
-- ============================================
CREATE OR REPLACE VIEW debt_aging_report AS
SELECT 
    c.id AS customer_id,
    c.full_name AS customer_name,
    c.phone,
    c.current_balance,
    SUM(CASE WHEN ct.created_at > NOW() - INTERVAL '7 days' THEN ct.amount ELSE 0 END) AS week1_debt,
    SUM(CASE WHEN ct.created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '8 days' THEN ct.amount ELSE 0 END) AS month1_debt,
    SUM(CASE WHEN ct.created_at < NOW() - INTERVAL '30 days' THEN ct.amount ELSE 0 END) AS older_debt,
    COUNT(CASE WHEN ct.paid_at IS NULL AND ct.transaction_type = 'credit' THEN 1 END) AS active_credit_count
FROM customers c
LEFT JOIN credit_transactions ct ON c.id = ct.customer_id
WHERE c.current_balance > 0
GROUP BY c.id, c.full_name, c.phone, c.current_balance
ORDER BY c.current_balance DESC;

-- ============================================
-- VIEW: Daily Sales Summary (Z-Report ready)
-- ============================================
CREATE OR REPLACE VIEW daily_sales_summary AS
SELECT 
    s.business_id,
    s.sale_date,
    COUNT(*) as total_transactions,
    SUM(s.total_amount) as total_sales,
    SUM(CASE WHEN s.payment_method = 'cash' THEN s.total_amount ELSE 0 END) as cash_sales,
    SUM(CASE WHEN s.payment_method != 'cash' AND s.payment_method != 'credit' THEN s.total_amount ELSE 0 END) as electronic_sales,
    SUM(CASE WHEN s.payment_status = 'credit' THEN s.total_amount ELSE 0 END) as credit_sales,
    SUM(CASE WHEN s.payment_status = 'credit' THEN s.total_amount - s.amount_paid ELSE 0 END) as outstanding_credit,
    SUM(s.tax_amount) as total_tax,
    SUM(si.profit_amount) as gross_profit
FROM sales s
LEFT JOIN sale_items si ON s.id = si.sale_id
WHERE s.status = 'completed'
GROUP BY s.business_id, s.sale_date;

-- ============================================
-- VIEW: Low Stock Alert
-- ============================================
CREATE OR REPLACE VIEW low_stock_alert AS
SELECT 
    p.id,
    p.business_id,
    p.name_translations,
    p.current_stock,
    p.min_stock_level,
    CASE 
        WHEN p.current_stock <= 0 THEN 'Out of Stock'
        WHEN p.current_stock <= p.min_stock_level THEN 'Low Stock'
        ELSE 'OK'
    END as stock_status
FROM products p
WHERE p.current_stock <= p.min_stock_level
AND p.is_active = true
ORDER BY p.current_stock ASC;

-- ============================================
-- VIEW: Expiring Products Alert
-- ============================================
CREATE OR REPLACE VIEW expiring_products_alert AS
SELECT 
    p.id,
    p.business_id,
    p.name_translations,
    p.expiry_date,
    p.batch_number,
    p.current_stock,
    (p.expiry_date - CURRENT_DATE) as days_until_expiry,
    CASE 
        WHEN p.expiry_date < CURRENT_DATE THEN 'Expired'
        WHEN p.expiry_date - CURRENT_DATE <= 7 THEN 'Expires This Week'
        WHEN p.expiry_date - CURRENT_DATE <= 30 THEN 'Expires This Month'
        ELSE 'OK'
    END as expiry_status
FROM products p
WHERE p.track_expiry = true 
AND p.is_active = true
AND p.expiry_date IS NOT NULL
ORDER BY p.expiry_date ASC;

-- ============================================
-- INSERT DEFAULT BUSINESS (for testing)
-- ============================================
INSERT INTO businesses (name, owner_name, phone, email, city) 
VALUES ('Demo Shop', 'Demo Owner', '0911000000', 'demo@example.com', 'Addis Ababa');