const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');

describe('Authentication API', () => {
    
    beforeAll(async () => {
        // Clean test data
        await pool.query('DELETE FROM users WHERE phone LIKE $1', ['+2519%']);
    });
    
    afterAll(async () => {
        await pool.end();
    });
    
    describe('POST /api/v2/auth/register', () => {
        it('should register a new business', async () => {
            const response = await request(app)
                .post('/api/v2/auth/register')
                .send({
                    business_name: 'Test Shop',
                    business_name_am: 'የሙከራ ሱቅ',
                    owner_name: 'Test Owner',
                    phone: '+251912345678',
                    password: 'TestPass123',
                    city: 'Addis Ababa',
                    region: 'Addis Ababa'
                });
            
            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
            expect(response.body.access_token).toBeDefined();
        });
        
        it('should reject duplicate phone number', async () => {
            const response = await request(app)
                .post('/api/v2/auth/register')
                .send({
                    business_name: 'Another Shop',
                    owner_name: 'Another Owner',
                    phone: '+251912345678', // Same phone
                    password: 'TestPass123'
                });
            
            expect(response.status).toBe(409);
        });
    });
    
    describe('POST /api/v2/auth/login', () => {
        it('should login with correct credentials', async () => {
            const response = await request(app)
                .post('/api/v2/auth/login')
                .send({
                    phone: '+251912345678',
                    password: 'TestPass123'
                });
            
            expect(response.status).toBe(200);
            expect(response.body.user.role).toBe('owner');
        });
        
        it('should reject wrong password', async () => {
            const response = await request(app)
                .post('/api/v2/auth/login')
                .send({
                    phone: '+251912345678',
                    password: 'WrongPassword'
                });
            
            expect(response.status).toBe(401);
        });
    });
});