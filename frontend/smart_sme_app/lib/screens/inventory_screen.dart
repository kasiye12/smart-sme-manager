import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';

class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  List<Product> _products = [];
  List<Product> _filteredProducts = [];
  bool _loading = true;
  String _searchQuery = '';

  final _nameEnController = TextEditingController();
  final _nameAmController = TextEditingController();
  final _costController = TextEditingController();
  final _priceController = TextEditingController();
  final _stockController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  @override
  void dispose() {
    _nameEnController.dispose();
    _nameAmController.dispose();
    _costController.dispose();
    _priceController.dispose();
    _stockController.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    setState(() => _loading = true);
    try {
      final products = await ApiService.getProducts();
      setState(() {
        _products = products.map((p) => Product.fromJson(p)).toList();
        _filterProducts();
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  void _filterProducts() {
    if (_searchQuery.isEmpty) {
      _filteredProducts = List.from(_products);
    } else {
      _filteredProducts = _products.where((p) =>
        p.name.toLowerCase().contains(_searchQuery.toLowerCase())
      ).toList();
    }
    setState(() {});
  }

  Future<void> _addProduct() async {
    final nameEn = _nameEnController.text.trim();
    final nameAm = _nameAmController.text.trim();
    final cost = double.tryParse(_costController.text) ?? 0;
    final price = double.tryParse(_priceController.text) ?? 0;
    final stock = int.tryParse(_stockController.text) ?? 0;

    if (nameEn.isEmpty || cost == 0 || price == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name, cost, and price required'), backgroundColor: Colors.red),
      );
      return;
    }

    final success = await ApiService.addProduct({
      'name_translations': {'en': nameEn, 'am': nameAm.isEmpty ? nameEn : nameAm},
      'cost_price': cost,
      'selling_price': price,
      'current_stock': stock,
    });

    if (success) {
      _nameEnController.clear();
      _nameAmController.clear();
      _costController.clear();
      _priceController.clear();
      _stockController.clear();
      _loadProducts();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Product added!'), backgroundColor: Colors.green),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to add product'), backgroundColor: Colors.red),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Add Product Form
        Container(
          padding: const EdgeInsets.all(12),
          color: Colors.blue[50],
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _nameEnController,
                      decoration: const InputDecoration(labelText: 'Name (EN)', border: OutlineInputBorder(), isDense: true),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _nameAmController,
                      decoration: const InputDecoration(labelText: 'ስም (AM)', border: OutlineInputBorder(), isDense: true),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: TextField(controller: _costController, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Cost', border: OutlineInputBorder(), isDense: true))),
                  const SizedBox(width: 8),
                  Expanded(child: TextField(controller: _priceController, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Price', border: OutlineInputBorder(), isDense: true))),
                  const SizedBox(width: 8),
                  Expanded(child: TextField(controller: _stockController, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Stock', border: OutlineInputBorder(), isDense: true))),
                ],
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _addProduct,
                  icon: const Icon(Icons.add),
                  label: const Text('Add Product'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white),
                ),
              ),
            ],
          ),
        ),

        // Search Bar
        Padding(
          padding: const EdgeInsets.all(8),
          child: TextField(
            decoration: const InputDecoration(
              hintText: 'Search products...',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (value) {
              _searchQuery = value;
              _filterProducts();
            },
          ),
        ),

        // Stats
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Total: ${_products.length} products', style: const TextStyle(fontWeight: FontWeight.bold)),
              Text('Value: ETB ${_products.fold(0.0, (sum, p) => sum + (p.sellingPrice * p.stock)).toStringAsFixed(2)}', style: const TextStyle(color: Colors.green)),
            ],
          ),
        ),

        // Product List
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _filteredProducts.isEmpty
                  ? const Center(child: Text('No products found'))
                  : ListView.builder(
                      itemCount: _filteredProducts.length,
                      itemBuilder: (context, index) {
                        final product = _filteredProducts[index];
                        final lowStock = product.stock <= 5;
                        return Card(
                          margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: lowStock ? Colors.red : Colors.green,
                              child: Icon(lowStock ? Icons.warning : Icons.check, color: Colors.white),
                            ),
                            title: Text(product.name, style: const TextStyle(fontWeight: FontWeight.bold)),
                            subtitle: Text('Stock: ${product.stock}'),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text('Sell: ETB ${product.sellingPrice.toStringAsFixed(2)}', style: const TextStyle(color: Colors.green)),
                                Text('Cost: ETB ${product.costPrice.toStringAsFixed(2)}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                                Text('Profit: ETB ${(product.sellingPrice - product.costPrice).toStringAsFixed(2)}', style: const TextStyle(fontSize: 11, color: Colors.orange)),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
        ),
      ],
    );
  }
}