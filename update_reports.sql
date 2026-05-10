-- 1. Add missing columns to sales table
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_sales DECIMAL(12,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS digital_sales DECIMAL(12,2) DEFAULT 0;

-- 2. Update daily_cashouts table with Z-Report fields
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS opening_cash_balance DECIMAL(12,2) DEFAULT 0;
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS cash_sales DECIMAL(12,2) DEFAULT 0;
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS cash_expenses DECIMAL(12,2) DEFAULT 0;
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS expected_cash_balance DECIMAL(12,2) DEFAULT 0;
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS actual_cash_balance DECIMAL(12,2);
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS cash_difference DECIMAL(12,2) DEFAULT 0;
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE daily_cashouts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- 3. Create growth_cache table
CREATE TABLE IF NOT EXISTS growth_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    report_date DATE NOT NULL,
    period_type VARCHAR(20) NOT NULL,
    revenue DECIMAL(12,2) DEFAULT 0,
    transactions INTEGER DEFAULT 0,
    customers INTEGER DEFAULT 0,
    gross_profit DECIMAL(12,2) DEFAULT 0,
    net_profit DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, report_date, period_type)
);

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method);
CREATE INDEX IF NOT EXISTS idx_cashouts_date ON daily_cashouts(cashout_date);

SELECT '✅ All updates applied!' AS result;
