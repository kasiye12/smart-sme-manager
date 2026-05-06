const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query, transaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const { validatePhone, validatePassword } = require('../utils/validators');

class AuthController {
    
    // ============================================
    // USER REGISTRATION (Business + Owner)
    // ============================================
    static async register(req, res, next) {
        try {
            const {
                business_name,
                business_name_am,
                owner_name,
                phone,
                password,
                city,
                region
            } = req.body;
            
            // Validate inputs
            if (!validatePhone(phone)) {
                throw new AppError('Invalid phone number format', 400);
            }
            
            if (!validatePassword(password)) {
                throw new AppError('Password must be at least 8 characters with numbers and letters', 400);
            }
            
            // Check if phone already registered
            const existing = await query(
                'SELECT id FROM users WHERE phone = $1',
                [phone]
            );
            
            if (existing.rows.length > 0) {
                throw new AppError('Phone number already registered', 409);
            }
            
            const result = await transaction(async (client) => {
                // Create business
                const businessResult = await client.query(`
                    INSERT INTO businesses (
                        name, name_translations, owner_name, phone, city, region
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id
                `, [
                    business_name,
                    JSON.stringify({ en: business_name, am: business_name_am || business_name }),
                    owner_name,
                    phone,
                    city,
                    region
                ]);
                
                const businessId = businessResult.rows[0].id;
                
                // Hash password
                const salt = await bcrypt.genSalt(12);
                const passwordHash = await bcrypt.hash(password, salt);
                
                // Create owner user
                const userResult = await client.query(`
                    INSERT INTO users (
                        business_id, full_name, phone, password_hash, role
                    ) VALUES ($1, $2, $3, $4, 'owner')
                    RETURNING id, business_id, role
                `, [businessId, owner_name, phone, passwordHash]);
                
                return {
                    business_id: businessId,
                    user: userResult.rows[0]
                };
            });
            
            // Generate tokens
            const tokens = AuthController.generateTokens(result.user);
            
            res.status(201).json({
                success: true,
                message: 'Business registered successfully',
                ...tokens,
                user: {
                    id: result.user.id,
                    business_id: result.user.business_id,
                    role: result.user.role
                }
            });
            
        } catch (error) {
            next(error);
        }
    }
    
    // ============================================
    // LOGIN
    // ============================================
    static async login(req, res, next) {
        try {
            const { phone, password, pin_code } = req.body;
            
            // Find user
            const result = await query(`
                SELECT 
                    u.id, u.business_id, u.full_name, u.password_hash, 
                    u.role, u.pin_code, u.is_active, u.locked_until,
                    u.login_attempts,
                    b.name as business_name,
                    b.is_active as business_active,
                    b.subscription_tier
                FROM users u
                JOIN businesses b ON u.business_id = b.id
                WHERE u.phone = $1
            `, [phone]);
            
            if (result.rows.length === 0) {
                throw new AppError('Invalid credentials', 401);
            }
            
            const user = result.rows[0];
            
            // Check if account is locked
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                const minutesLeft = Math.ceil(
                    (new Date(user.locked_until) - new Date()) / 60000
                );
                throw new AppError(
                    `Account locked. Try again in ${minutesLeft} minutes`,
                    423
                );
            }
            
            // Check if business is active
            if (!user.business_active) {
                throw new AppError('Business account is deactivated', 403);
            }
            
            // Check if user is active
            if (!user.is_active) {
                throw new AppError('User account is deactivated', 403);
            }
            
            // Verify password or PIN
            let authenticated = false;
            
            if (password) {
                authenticated = await bcrypt.compare(password, user.password_hash);
            } else if (pin_code) {
                authenticated = pin_code === user.pin_code;
            }
            
            if (!authenticated) {
                // Record failed attempt
                await query(`
                    UPDATE users 
                    SET login_attempts = login_attempts + 1,
                        locked_until = CASE 
                            WHEN login_attempts >= 4 THEN NOW() + INTERVAL '30 minutes'
                            ELSE locked_until
                        END
                    WHERE id = $1
                `, [user.id]);
                
                throw new AppError('Invalid credentials', 401);
            }
            
            // Reset login attempts on success
            await query(`
                UPDATE users 
                SET login_attempts = 0, 
                    locked_until = NULL,
                    last_login_at = NOW()
                WHERE id = $1
            `, [user.id]);
            
            // Generate tokens
            const tokens = AuthController.generateTokens({
                id: user.id,
                business_id: user.business_id,
                role: user.role
            });
            
            res.json({
                success: true,
                ...tokens,
                user: {
                    id: user.id,
                    full_name: user.full_name,
                    business_name: user.business_name,
                    business_id: user.business_id,
                    role: user.role,
                    subscription: user.subscription_tier
                }
            });
            
        } catch (error) {
            next(error);
        }
    }
    
    // ============================================
    // TOKEN REFRESH
    // ============================================
    static async refreshToken(req, res, next) {
        try {
            const { refresh_token } = req.body;
            
            const decoded = jwt.verify(
                refresh_token,
                process.env.JWT_REFRESH_SECRET
            );
            
            // Verify user still exists and is active
            const result = await query(
                'SELECT id, business_id, role, is_active FROM users WHERE id = $1',
                [decoded.id]
            );
            
            if (result.rows.length === 0 || !result.rows[0].is_active) {
                throw new AppError('Invalid token', 401);
            }
            
            const tokens = AuthController.generateTokens(result.rows[0]);
            
            res.json({
                success: true,
                ...tokens
            });
            
        } catch (error) {
            if (error.name === 'JsonWebTokenError') {
                next(new AppError('Invalid token', 401));
            } else if (error.name === 'TokenExpiredError') {
                next(new AppError('Token expired', 401));
            } else {
                next(error);
            }
        }
    }
    
    // ============================================
    // LOGOUT
    // ============================================
    static async logout(req, res) {
        // In a real app, you'd add the token to a blacklist in Redis
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    }
    
    // ============================================
    // HELPER: Generate Tokens
    // ============================================
    static generateTokens(user) {
        const accessToken = jwt.sign(
            {
                id: user.id,
                business_id: user.business_id,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );
        
        const refreshToken = jwt.sign(
            { id: user.id, type: 'refresh' },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
        );
        
        return { access_token: accessToken, refresh_token: refreshToken };
    }
}

module.exports = AuthController;