import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import '../services/api_service.dart';

class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});

  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  List<dynamic> _customers = [];
  bool _loading = true;
  String _error = '';

  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _creditController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _creditController.dispose();
    super.dispose();
  }

  Future<void> _loadCustomers() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final headers = await ApiService.getHeaders();
      final response = await http
          .get(
            Uri.parse('${ApiService.baseUrl}/customers'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          _customers = data['customers'] ?? [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = 'Failed to load customers';
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

  Future<void> _addCustomer() async {
    final name = _nameController.text.trim();
    final phone = _phoneController.text.trim();
    final credit = double.tryParse(_creditController.text) ?? 0;

    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter customer name'), backgroundColor: Colors.red),
      );
      return;
    }

    try {
      final headers = await ApiService.getHeaders();
      final response = await http
          .post(
            Uri.parse('${ApiService.baseUrl}/customers'),
            headers: headers,
            body: jsonEncode({
              'full_name': name,
              'phone': phone,
              'credit_limit': credit,
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 201) {
        _nameController.clear();
        _phoneController.clear();
        _creditController.clear();
        _loadCustomers();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Customer added successfully!'), backgroundColor: Colors.green),
        );
      } else {
        final error = jsonDecode(response.body)['error'] ?? 'Failed to add customer';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error), backgroundColor: Colors.red),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Cannot connect to server'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _deleteCustomer(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Customer'),
        content: const Text('Are you sure you want to delete this customer?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    try {
      final headers = await ApiService.getHeaders();
      await http.delete(
        Uri.parse('${ApiService.baseUrl}/customers/$id'),
        headers: headers,
      );
      _loadCustomers();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Customer deleted'), backgroundColor: Colors.orange),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to delete'), backgroundColor: Colors.red),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Add Customer Form
        Container(
          padding: const EdgeInsets.all(12),
          color: Colors.blue[50],
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Add New Customer', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: TextField(
                      controller: _nameController,
                      decoration: const InputDecoration(
                        labelText: 'Full Name *',
                        hintText: 'Customer name',
                        border: OutlineInputBorder(),
                        isDense: true,
                        prefixIcon: Icon(Icons.person),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                        labelText: 'Phone',
                        hintText: '2519...',
                        border: OutlineInputBorder(),
                        isDense: true,
                        prefixIcon: Icon(Icons.phone),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _creditController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Credit Limit',
                        hintText: '0',
                        border: OutlineInputBorder(),
                        isDense: true,
                        prefixIcon: Icon(Icons.credit_card),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: _addCustomer,
                    icon: const Icon(Icons.add),
                    label: const Text('Add'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.blue,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        // Header Row
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: Colors.grey[200],
          child: Row(
            children: [
              const Expanded(flex: 3, child: Text('Name', style: TextStyle(fontWeight: FontWeight.bold))),
              const Expanded(flex: 2, child: Text('Phone', style: TextStyle(fontWeight: FontWeight.bold))),
              const Expanded(flex: 2, child: Text('Balance', style: TextStyle(fontWeight: FontWeight.bold))),
              const SizedBox(width: 40),
            ],
          ),
        ),

        // Customer List
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error.isNotEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.error_outline, size: 50, color: Colors.red),
                          const SizedBox(height: 12),
                          Text(_error, style: const TextStyle(color: Colors.red)),
                          const SizedBox(height: 12),
                          ElevatedButton.icon(
                            onPressed: _loadCustomers,
                            icon: const Icon(Icons.refresh),
                            label: const Text('Retry'),
                          ),
                        ],
                      ),
                    )
                  : _customers.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.people_outline, size: 60, color: Colors.grey),
                              const SizedBox(height: 12),
                              const Text('No customers yet', style: TextStyle(fontSize: 16, color: Colors.grey)),
                              const Text('Add your first customer above', style: TextStyle(color: Colors.grey)),
                            ],
                          ),
                        )
                      : ListView.builder(
                          itemCount: _customers.length,
                          itemBuilder: (context, index) {
                            final customer = _customers[index];
                            final balance = double.tryParse((customer['current_balance'] ?? 0).toString()) ?? 0;
                            final isOwing = balance > 0;

                            return Card(
                              margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: isOwing ? Colors.orange : Colors.green,
                                  child: Icon(
                                    isOwing ? Icons.money_off : Icons.person,
                                    color: Colors.white,
                                    size: 20,
                                  ),
                                ),
                                title: Text(
                                  customer['full_name'] ?? 'Unknown',
                                  style: const TextStyle(fontWeight: FontWeight.bold),
                                ),
                                subtitle: Text(customer['phone'] ?? 'No phone'),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      crossAxisAlignment: CrossAxisAlignment.end,
                                      children: [
                                        Text(
                                          'ETB ${balance.toStringAsFixed(2)}',
                                          style: TextStyle(
                                            color: isOwing ? Colors.red : Colors.green,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                        if (isOwing) const Text('Owing', style: TextStyle(fontSize: 10, color: Colors.red)),
                                      ],
                                    ),
                                    IconButton(
                                      icon: const Icon(Icons.delete_outline, color: Colors.red, size: 20),
                                      onPressed: () => _deleteCustomer(customer['id']),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
        ),

        // Summary Footer
        if (_customers.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(12),
            color: Colors.blue[50],
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Text('Total: ${_customers.length} customers', style: const TextStyle(fontWeight: FontWeight.bold)),
                Text(
                  'Owing: ETB ${_customers.fold(0.0, (sum, c) => sum + (double.tryParse((c['current_balance'] ?? 0).toString()) ?? 0)).toStringAsFixed(2)}',
                  style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
      ],
    );
  }
}