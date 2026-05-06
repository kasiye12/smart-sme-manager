import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'dart:convert';

class LocalDB {
  static final LocalDB instance = LocalDB._init();
  static Database? _database;

  LocalDB._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('sme_local.db');
    return _database!;
  }

  Future<Database> _initDB(String name) async {
    final dbPath = await getDatabasesPath();
    return await openDatabase(
      join(dbPath, name),
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE products (
            id TEXT PRIMARY KEY,
            data TEXT,
            synced INTEGER DEFAULT 0
          )
        ''');
        await db.execute('''
          CREATE TABLE pending_sales (
            id TEXT PRIMARY KEY,
            data TEXT,
            created_at TEXT
          )
        ''');
      },
    );
  }

  Future<void> saveProducts(List<dynamic> products) async {
    final db = await database;
    await db.delete('products');
    for (final p in products) {
      await db.insert('products', {
        'id': p['id'],
        'data': jsonEncode(p),
        'synced': 1,
      });
    }
  }

  Future<List<dynamic>> getCachedProducts() async {
    final db = await database;
    final result = await db.query('products');
    return result.map((r) => jsonDecode(r['data'] as String)).toList();
  }

  Future<void> savePendingSale(Map<String, dynamic> sale) async {
    final db = await database;
    await db.insert('pending_sales', {
      'id': DateTime.now().millisecondsSinceEpoch.toString(),
      'data': jsonEncode(sale),
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, dynamic>>> getPendingSales() async {
    final db = await database;
    final result = await db.query('pending_sales');
    return result.map((r) => jsonDecode(r['data'] as String) as Map<String, dynamic>).toList();
  }

  Future<void> clearPendingSales() async {
    final db = await database;
    await db.delete('pending_sales');
  }
}
