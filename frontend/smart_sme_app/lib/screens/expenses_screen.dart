import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/api_service.dart';

class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});
  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  List<dynamic> _expenses = [];
  bool _loading = true;
  
  final _descController = TextEditingController();
  final _amountController = TextEditingController();
  String _category = 'other';

  final _categories = ['rent', 'salary', 'utilities', 'supplies', 'transport', 'marketing', 'other'];

  @override
  void initState() { super.initState(); _loadExpenses(); }

  Future<void> _loadExpenses() async {
    setState(() => _loading = true);
    try {
      final headers = await ApiService.getHeaders();
      final res = await http.get(Uri.parse('${ApiService.baseUrl}/expenses'), headers: headers);
      if (res.statusCode == 200) {
        setState(() { _expenses = jsonDecode(res.body)['expenses']; _loading = false; });
      }
    } catch (e) { setState(() => _loading = false); }
  }

  Future<void> _addExpense() async {
    if (_amountController.text.isEmpty) return;
    try {
      final headers = await ApiService.getHeaders();
      await http.post(
        Uri.parse('${ApiService.baseUrl}/expenses'),
        headers: headers,
        body: jsonEncode({
          'category': _category,
          'amount': double.parse(_amountController.text),
          'description': _descController.text,
          'expense_date': DateTime.now().toIso8601String().split('T')[0],
        }),
      );
      _descController.clear();
      _amountController.clear();
      _loadExpenses();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Expense added'), backgroundColor: Colors.green));
    } catch (e) {}
  }

  double get _total => _expenses.fold(0, (sum, e) => sum + (double.tryParse(e['amount'].toString()) ?? 0));

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Container(padding: const EdgeInsets.all(12), color: Colors.red[50],
        child: Column(children: [
          Row(children: [
            Expanded(child: TextField(controller: _descController, decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder(), isDense: true))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _amountController, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount', border: OutlineInputBorder(), isDense: true))),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            DropdownButton<String>(
              value: _category,
              items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
              onChanged: (v) => setState(() => _category = v!),
            ),
            const Spacer(),
            ElevatedButton.icon(onPressed: _addExpense, icon: const Icon(Icons.add), label: const Text('Add Expense'), style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white)),
          ]),
        ]),
      ),
      Padding(padding: const EdgeInsets.all(8), child: Text('Total Expenses: ETB ${_total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.red))),
      Expanded(
        child: _loading ? const Center(child: CircularProgressIndicator())
            : _expenses.isEmpty ? const Center(child: Text('No expenses'))
            : ListView.builder(
                itemCount: _expenses.length,
                itemBuilder: (context, index) {
                  final e = _expenses[index];
                  return ListTile(
                    leading: CircleAvatar(backgroundColor: Colors.red, child: Text(e['category'][0].toUpperCase(), style: const TextStyle(color: Colors.white))),
                    title: Text(e['description'] ?? e['category']),
                    subtitle: Text(e['expense_date']?.toString().split('T')[0] ?? ''),
                    trailing: Text('ETB ${e['amount']}', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.red)),
                  );
                },
              ),
      ),
    ]);
  }
}
