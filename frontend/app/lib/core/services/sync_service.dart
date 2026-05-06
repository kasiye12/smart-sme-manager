import 'dart:async';
import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';
import '../config/api_config.dart';
import 'local_database.dart';
import 'auth_service.dart';

class SyncService {
  static final SyncService _instance = SyncService._internal();
  factory SyncService() => _instance;
  SyncService._internal();

  final Connectivity _connectivity = Connectivity();
  final LocalDatabase _localDb = LocalDatabase.instance;
  final Uuid _uuid = Uuid();
  
  Timer? _syncTimer;
  bool _isSyncing = false;
  String deviceId = '';

  static Future<void> init() async {
    _instance.deviceId = await _instance._getDeviceId();
    _instance._startListening();
    _instance._startPeriodicSync();
  }

  void _startListening() {
    _connectivity.onConnectivityChanged.listen((result) {
      if (result != ConnectivityResult.none) {
        // Internet is back, start syncing
        syncData();
      }
    });
  }

  void _startPeriodicSync() {
    // Sync every 2 minutes if online
    _syncTimer = Timer.periodic(
      const Duration(minutes: 2),
      (_) => syncData(),
    );
  }

  Future<void> syncData() async {
    if (_isSyncing) return;
    
    final connectivity = await _connectivity.checkConnectivity();
    if (connectivity == ConnectivityResult.none) return;
    
    _isSyncing = true;
    
    try {
      // Push local changes
      await _pushChanges();
      
      // Pull server changes
      await _pullChanges();
      
      // Sync was successful
      print('Sync completed at ${DateTime.now()}');
      
    } catch (e) {
      print('Sync failed: $e');
    } finally {
      _isSyncing = false;
    }
  }

  Future<void> _pushChanges() async {
    final pendingSyncs = await _localDb.getPendingSyncs();
    
    if (pendingSyncs.isEmpty) return;
    
    final token = await AuthService.getAccessToken();
    
    final response = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/v2/sync/push'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
        'X-Device-ID': deviceId,
      },
      body: jsonEncode({
        'device_id': deviceId,
        'changes': pendingSyncs.map((sync) => {
          'table_name': sync['table_name'],
          'record_id': sync['record_id'],
          'operation': sync['action'],
          'data': jsonDecode(sync['data']),
          'client_timestamp': sync['created_at'],
          'vector_clock': {},
        }).toList(),
      }),
    );
    
    if (response.statusCode == 200) {
      final result = jsonDecode(response.body);
      
      // Mark synced records
      for (final detail in result['details']) {
        if (detail['status'] == 'synced') {
          // Find the original sync record
          final syncRecord = pendingSyncs.firstWhere(
            (s) => s['record_id'] == detail['record_id']
          );
          await _localDb.markAsSynced(
            syncRecord['table_name'],
            syncRecord['record_id'],
          );
        } else if (detail['status'] == 'conflict') {
          // Handle conflict
          print('Conflict detected: ${detail['message']}');
          // Update local data with server version
        }
      }
    } else {
      // Increment retry count for failed syncs
      for (final sync in pendingSyncs) {
        final db = await _localDb.database;
        await db.rawUpdate(
          'UPDATE sync_queue SET retry_count = retry_count + 1 WHERE id = ?',
          [sync['id']],
        );
      }
    }
  }

  Future<void> _pullChanges() async {
    final token = await AuthService.getAccessToken();
    final lastSync = await _getLastSyncTimestamp();
    
    final response = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/api/v2/sync/pull?device_id=$deviceId&last_sync=$lastSync'),
      headers: {
        'Authorization': 'Bearer $token',
      },
    );
    
    if (response.statusCode == 200) {
      final result = jsonDecode(response.body);
      
      // Apply changes to local database
      for (final change in result['changes']) {
        await _applyServerChange(change);
      }
      
      // Save new sync timestamp
      await _saveLastSyncTimestamp(result['server_time']);
    }
  }

  Future<void> _applyServerChange(Map<String, dynamic> change) async {
    final db = await _localDb.database;
    
    switch (change['operation']) {
      case 'INSERT':
        await db.insert(
          change['table_name'],
          change['data'],
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
        break;
        
      case 'UPDATE':
        await db.update(
          change['table_name'],
          change['data'],
          where: 'id = ?',
          whereArgs: [change['record_id']],
        );
        break;
        
      case 'DELETE':
        await db.delete(
          change['table_name'],
          where: 'id = ?',
          whereArgs: [change['record_id']],
        );
        break;
    }
  }

  Future<String> _getDeviceId() async {
    // Get unique device ID
    // In production, use device_info_plus package
    return 'device_${_uuid.v4()}';
  }

  Future<String> _getLastSyncTimestamp() async {
    // Get from SharedPreferences
    return DateTime.now().subtract(const Duration(hours: 24)).toIso8601String();
  }

  Future<void> _saveLastSyncTimestamp(String timestamp) async {
    // Save to SharedPreferences
  }

  void dispose() {
    _syncTimer?.cancel();
  }
}