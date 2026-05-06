const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');
const { query } = require('../config/database');

// Verify JWT token
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new AppError('Access denied. No token provided', 401);
        }
        
        const token = authHeader.split(' ')[1];
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Verify user exists and is active
        const result = await query(
            'SELECT id, business_id, role, is_active FROM users WHERE id = $1',
            [decoded.id]
        );
        
        if (result.rows.length === 0) {
            throw new AppError('User not found', 401);
        }
        
        const user = result.rows[0];
        
        if (!user.is_active) {
            throw new AppError('Account is deactivated', 403);
        }
        
        // Attach user to request
        req.user = {
            id: user.id,
            business_id: user.business_id,
            role: user.role
        };
        
        next();
        
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            next(new AppError('Invalid token', 401));
        } else if (error.name === 'TokenExpiredError') {
            next(new AppError('Token expired', 401));
        } else {
            next(error);
        }
    }
};

// Role-based authorization
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return next(new AppError(
                'You do not have permission to perform this action',
                403
            ));
        }
        next();
    };
};

// Check subscription
const checkSubscription = (requiredTier) => {
    return async (req, res, next) => {
        try {
            const result = await query(
                `SELECT subscription_tier, subscription_expires_at 
                 FROM businesses WHERE id = $1`,
                [req.user.business_id]
            );
            
            const business = result.rows[0];
            
            const tierLevels = {
                'free': 0,
                'basic': 1,
                'premium': 2,
                'enterprise': 3
            };
            
            if (tierLevels[business.subscription_tier] < tierLevels[requiredTier]) {
                throw new AppError(
                    'Please upgrade your subscription to access this feature',
                    403
                );
            }
            
            next();
        } catch (error) {
            next(error);
        }
    };
};

module.exports = {
    authenticate,
    authorize,
    checkSubscription
};