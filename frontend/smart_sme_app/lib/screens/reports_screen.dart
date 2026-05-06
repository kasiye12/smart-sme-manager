import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import '../services/api_service.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Map<String, dynamic>? _report;
  bool _loading = false;
  String _error = '';
  String _selectedDate = '';

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now().toIso8601String().split('T')[0];
    _loadReport();
  }

  Future<void> _loadReport() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final headers = await ApiService.getHeaders();
      final response = await http
          .get(
            Uri.parse('${ApiService.baseUrl}/reports/daily?date=$_selectedDate'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        setState(() {
          _report = jsonDecode(response.body);
          _loading = false;
        });
      } else {
        setState(() {
          _error = 'Failed to load report';
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Cannot connect to server. Is backend running?';
        _loading = false;
      });
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_selectedDate),
      firstDate: DateTime(2024),
      lastDate: DateTime.now(),
      helpText: 'Select report date',
    );

    if (picked != null) {
      setState(() {
        _selectedDate = picked.toIso8601String().split('T')[0];
      });
      _loadReport();
    }
  }

  @override
  Widget build(BuildContext context) {
    final totalRevenue = double.tryParse((_report?['total_revenue'] ?? '0').toString()) ?? 0;
    final grossProfit = double.tryParse((_report?['gross_profit'] ?? '0').toString()) ?? 0;
    final totalTax = double.tryParse((_report?['total_tax'] ?? '0').toString()) ?? 0;
    final totalSales = int.tryParse((_report?['total_sales'] ?? '0').toString()) ?? 0;
    final uniqueCustomers = int.tryParse((_report?['unique_customers'] ?? '0').toString()) ?? 0;
    final totalDiscounts = double.tryParse((_report?['total_discounts'] ?? '0').toString()) ?? 0;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with Date Picker
          Card(
            elevation: 2,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Daily Report', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                  Row(
                    children: [
                      Text(_selectedDate, style: const TextStyle(fontSize: 14, color: Colors.grey)),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: const Icon(Icons.calendar_month, color: Colors.blue),
                        onPressed: _pickDate,
                        tooltip: 'Change date',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // Loading
          if (_loading)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(40),
                child: CircularProgressIndicator(),
              ),
            ),

          // Error
          if (_error.isNotEmpty)
            Center(
              child: Column(
                children: [
                  const Icon(Icons.error_outline, size: 60, color: Colors.red),
                  const SizedBox(height: 12),
                  Text(_error, style: const TextStyle(color: Colors.red, fontSize: 16)),
                  const SizedBox(height: 12),
                  ElevatedButton.icon(
                    onPressed: _loadReport,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry'),
                  ),
                ],
              ),
            ),

          // Report Cards
          if (!_loading && _report != null) ...[
            // Main Metrics Row
            Row(
              children: [
                Expanded(
                  child: _buildMetricCard(
                    'Total Sales',
                    '$totalSales',
                    'Transactions',
                    Colors.blue,
                    Icons.shopping_cart,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMetricCard(
                    'Customers',
                    '$uniqueCustomers',
                    'Unique',
                    Colors.purple,
                    Icons.people,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // Revenue Card
            _buildLargeCard(
              'Total Revenue',
              'ETB ${totalRevenue.toStringAsFixed(2)}',
              Colors.green,
              Icons.trending_up,
            ),

            const SizedBox(height: 12),

            // Profit & Tax Row
            Row(
              children: [
                Expanded(
                  child: _buildMetricCard(
                    'Gross Profit',
                    'ETB ${grossProfit.toStringAsFixed(2)}',
                    '${totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toStringAsFixed(1) : 0}% margin',
                    Colors.orange,
                    Icons.savings,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMetricCard(
                    'Tax (VAT)',
                    'ETB ${totalTax.toStringAsFixed(2)}',
                    '15%',
                    Colors.red,
                    Icons.receipt_long,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // Discounts
            if (totalDiscounts > 0)
              _buildLargeCard(
                'Total Discounts',
                'ETB ${totalDiscounts.toStringAsFixed(2)}',
                Colors.amber,
                Icons.discount,
              ),

            const SizedBox(height: 24),

            // Net Profit Summary
            Card(
              elevation: 4,
              color: Colors.blue[50],
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    const Text('Net Profit Summary', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Revenue'),
                        Text('ETB ${totalRevenue.toStringAsFixed(2)}'),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Tax'),
                        Text('- ETB ${totalTax.toStringAsFixed(2)}', style: const TextStyle(color: Colors.red)),
                      ],
                    ),
                    if (totalDiscounts > 0) ...[
                      const SizedBox(height: 4),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Discounts'),
                          Text('- ETB ${totalDiscounts.toStringAsFixed(2)}', style: const TextStyle(color: Colors.red)),
                        ],
                      ),
                    ],
                    const Divider(),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Net Profit', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                        Text(
                          'ETB ${(grossProfit - totalTax - totalDiscounts).toStringAsFixed(2)}',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                            color: (grossProfit - totalTax - totalDiscounts) >= 0 ? Colors.green : Colors.red,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],

          // No data
          if (!_loading && _report == null && _error.isEmpty)
            Center(
              child: Column(
                children: [
                  const SizedBox(height: 40),
                  const Icon(Icons.bar_chart, size: 60, color: Colors.grey),
                  const SizedBox(height: 12),
                  const Text('No data for this date', style: TextStyle(fontSize: 16, color: Colors.grey)),
                  const Text('Make a sale to see reports', style: TextStyle(color: Colors.grey)),
                  const SizedBox(height: 20),
                  ElevatedButton.icon(
                    onPressed: _loadReport,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Load Report'),
                  ),
                ],
              ),
            ),

          const SizedBox(height: 20),

          // Refresh Button
          Center(
            child: ElevatedButton.icon(
              onPressed: _loading ? null : _loadReport,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh Report'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.blue,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricCard(String title, String value, String subtitle, Color color, IconData icon) {
    return Card(
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: color, size: 24),
                const SizedBox(width: 8),
                Text(title, style: const TextStyle(fontSize: 13, color: Colors.grey)),
              ],
            ),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color)),
            const SizedBox(height: 2),
            Text(subtitle, style: const TextStyle(fontSize: 11, color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildLargeCard(String title, String value, Color color, IconData icon) {
    return Card(
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: color, size: 30),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 14, color: Colors.grey)),
                  const SizedBox(height: 4),
                  Text(value, style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: color)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}