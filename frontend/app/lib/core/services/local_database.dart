import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'dart:convert';

class LocalDatabase {
  static final LocalDatabase instance = LocalDatabase._init();
  static Database? _database;

  LocalDatabase._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('smart_sme_local.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
      onUpgrade: _upgradeDB,
    );
  }

  Future<void> _createDB(Database db, int version) async {
    // Products table
    await db.execute('''
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        category_id TEXT,
        name_translations TEXT NOT NULL,
        barcode TEXT,
        sku TEXT,
        cost_price REAL NOT NULL,
        selling_price REAL NOT NULL,
        current_stock INTEGER DEFAULT 0,
        min_stock_level INTEGER DEFAULT 5,
        is_active INTEGER DEFAULT 1,
        is_synced INTEGER DEFAULT 0,
        sync_action TEXT,
        local_updated_at TEXT,
        server_updated_at TEXT,
        vector_clock TEXT
      )
    ''');

    // Sales table
    await db.execute('''
      CREATE TABLE sales (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        customer_id TEXT,
        sale_number TEXT,
        subtotal REAL NOT NULL,
        discount_amount REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        amount_paid REAL DEFAULT 0,
        payment_status TEXT DEFAULT 'paid',
        payment_method TEXT,
        is_synced INTEGER DEFAULT 0,
        sync_action TEXT,
        created_at TEXT NOT NULL,
        vector_clock TEXT
      )
    ''');

    // Sale items
    await db.execute('''
      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        cost_price REAL NOT NULL,
        total_price REAL NOT NULL,
        is_synced INTEGER DEFAULT 0,
        FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
      )
    ''');

    // Customers
    await db.execute('''
      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT,
        credit_limit REAL DEFAULT 0,
        current_balance REAL DEFAULT 0,
        is_synced INTEGER DEFAULT 0,
        sync_action TEXT,
        local_updated_at TEXT
      )
    ''');

    // Sync queue
    await db.execute('''
      CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        action TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0
      )
    ''');

    // Create indexes
    await db.execute('CREATE INDEX idx_products_barcode ON products(barcode)');
    await db.execute('CREATE INDEX idx_sales_date ON sales(created_at)');
    await db.execute('CREATE INDEX idx_sync_queue ON sync_queue(retry_count)');
  }

  Future<void> _upgradeDB(Database db, int oldVersion, int newVersion) async {
    // Future migrations
  }

  // ============================================
  // CRUD OPERATIONS WITH SYNC TRACKING
  // ============================================
  
  Future<String> insertProduct(Map<String, dynamic> product) async {
    final db = await database;
    
    await db.insert('products', {
      ...product,
      'is_synced': 0,
      'sync_action': 'INSERT',
      'local_updated_at': DateTime.now().toIso8601String(),
    });
    
    // Add to sync queue
    await addToSyncQueue('products', product['id'], 'INSERT', product);
    
    return product['id'];
  }

  Future<void> updateProduct(String id, Map<String, dynamic> updates) async {
    final db = await database;
    
    await db.update(
      'products',
      {
        ...updates,
        'is_synced': 0,
        'sync_action': 'UPDATE',
        'local_updated_at': DateTime.now().toIso8601String(),
      },
      where: 'id = ?',
      whereArgs: [id],
    );
    
    await addToSyncQueue('products', id, 'UPDATE', updates);
  }

  Future<String> recordSale(Map<String, dynamic> saleData) async {
    final db = await database;
    final batch = db.batch();
    
    // Insert sale
    batch.insert('sales', {
      ...saleData,
      'is_synced': 0,
      'sync_action': 'INSERT',
      'created_at': DateTime.now().toIso8601String(),
    });
    
    // Insert sale items and update stock
    final items = saleData['items'] as List<Map<String, dynamic>>;
    for (final item in items) {
      batch.insert('sale_items', {
        ...item,
        'sale_id': saleData['id'],
        'is_synced': 0,
      });
      
      // Update product stock locally
      batch.rawUpdate(
        'UPDATE products SET current_stock = current_stock - ? WHERE id = ?',
        [item['quantity'], item['product_id']],
      );
    }
    
    await batch.commit(noResult: true);
    
    await addToSyncQueue('sales', saleData['id'], 'INSERT', saleData);
    
    return saleData['id'];
  }

  // ============================================
  // SYNC QUEUE MANAGEMENT
  // ============================================
  
  Future<void> addToSyncQueue(
    String tableName, 
    String recordId, 
    String action, 
    Map<String, dynamic> data
  ) async {
    final db = await database;
    
    await db.insert('sync_queue', {
      'table_name': tableName,
      'record_id': recordId,
      'action': action,
      'data': jsonEncode(data),
      'created_at': DateTime.now().toIso8601String(),
      'retry_count': 0,
    });
  }

  Future<List<Map<String, dynamic>>> getPendingSyncs() async {
    final db = await database;
    
    return await db.query(
      'sync_queue',
      where: 'retry_count < 5',
      orderBy: 'created_at ASC',
      limit: 50,
    );
  }

  Future<void> markAsSynced(String tableName, String recordId) async {
    final db = await database;
    
    await db.update(
      tableName,
      {'is_synced': 1, 'sync_action': null},
      where: 'id = ?',
      whereArgs: [recordId],
    );
    
    await db.delete(
      'sync_queue',
      where: 'table_name = ? AND record_id = ?',
      whereArgs: [tableName, recordId],
    );
  }

  // Close database
  Future<void> close() async {
    final db = await database;
    db.close();
  }
}