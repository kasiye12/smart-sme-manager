import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';

class POSScreen extends StatefulWidget {
  const POSScreen({super.key});
  @override
  State<POSScreen> createState() => _POSScreenState();
}

class _POSScreenState extends State<POSScreen> {
  List<Product> _products = [];
  List<Product> _cart = [];
  bool _loading = true;
  String _searchQuery = '';
  double _discount = 0;
  String _paymentMethod = 'cash';
  String _error = '';

  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  Future<void> _loadProducts() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final products = await ApiService.getProducts();
      setState(() {
        _products = products.map((p) => Product.fromJson(p)).toList();
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = 'Cannot connect to server'; });
    }
  }

  List<Product> get _filteredProducts {
    if (_searchQuery.isEmpty) return _products;
    return _products.where((p) => p.name.toLowerCase().contains(_searchQuery.toLowerCase())).toList();
  }

  void _addToCart(Product product) {
    setState(() {
      final index = _cart.indexWhere((p) => p.id == product.id);
      if (index >= 0) {
        _cart[index].quantity++;
      } else {
        product.quantity = 1;
        _cart.add(product);
      }
    });
  }

  void _removeFromCart(Product product) {
    setState(() {
      if (product.quantity > 1) {
        product.quantity--;
      } else {
        _cart.remove(product);
      }
    });
  }

  double get _subtotal => _cart.fold(0, (sum, item) => sum + item.total);
  double get _tax => (_subtotal - _discount) * 0.15;
  double get _total => _subtotal - _discount + _tax;

  Future<void> _checkout() async {
    if (_cart.isEmpty) return;
    
    final items = _cart.map((p) => {'product_id': p.id, 'quantity': p.quantity}).toList();
    
    setState(() => _loading = true);
    
    try {
      final result = await ApiService.makeSale({
        'items': items,
        'payment_method': _paymentMethod,
        'amount_paid': _total,
        'discount_amount': _discount,
        'tax_amount': _tax,
      });
      
      if (result['success']) {
        setState(() {
          _cart.clear();
          _discount = 0;
          _loading = false;
        });
        _loadProducts();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Sale done! Total: ETB ${_total.toStringAsFixed(2)}'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Header
        Container(padding: const EdgeInsets.all(12), color: Colors.blue,
          child: SafeArea(
            child: Column(children: [
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('POS', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                Row(children: [
                  const Icon(Icons.shopping_cart, color: Colors.white, size: 20),
                  const SizedBox(width: 4),
                  Text('${_cart.fold(0, (sum, p) => sum + p.quantity)} items', style: const TextStyle(color: Colors.white)),
                  const SizedBox(width: 12),
                  Text('ETB ${_total.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ]),
              ]),
              const SizedBox(height: 8),
              TextField(
                controller: _searchController,
                decoration: const InputDecoration(
                  hintText: 'Search products...',
                  prefixIcon: Icon(Icons.search, color: Colors.white),
                  filled: true,
                  fillColor: Colors.white24,
                  border: OutlineInputBorder(borderSide: BorderSide.none),
                  isDense: true,
                ),
                style: const TextStyle(color: Colors.white),
                onChanged: (v) => setState(() => _searchQuery = v),
              ),
            ]),
          ),
        ),

        // Product Grid
        Expanded(
          child: _loading && _products.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : _error.isNotEmpty
                  ? Center(child: Text(_error))
                  : GridView.builder(
                      padding: const EdgeInsets.all(8),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 6, mainAxisSpacing: 6, childAspectRatio: 1.2),
                      itemCount: _filteredProducts.length,
                      itemBuilder: (context, index) {
                        final p = _filteredProducts[index];
                        return GestureDetector(
                          onTap: () => _addToCart(p),
                          child: Card(
                            elevation: 2,
                            color: p.stock <= 5 ? Colors.orange[50] : null,
                            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                              Text(p.name, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                              Text('ETB ${p.sellingPrice.toStringAsFixed(2)}', style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
                              Text('Stock: ${p.stock}', style: TextStyle(fontSize: 11, color: p.stock <= 5 ? Colors.red : Colors.grey)),
                            ]),
                          ),
                        );
                      },
                    ),
        ),

        // Cart
        if (_cart.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(8),
            color: Colors.white,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              // Cart items
              SizedBox(height: 60,
                child: ListView.builder(scrollDirection: Axis.horizontal, itemCount: _cart.length,
                  itemBuilder: (context, index) {
                    final item = _cart[index];
                    return Card(color: Colors.blue[50],
                      child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                            Text(item.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
                            Text('ETB ${item.total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 10)),
                          ]),
                          const SizedBox(width: 4),
                          GestureDetector(onTap: () => _addToCart(item), child: const Icon(Icons.add_circle, color: Colors.green, size: 18)),
                          Text('${item.quantity}', style: const TextStyle(fontWeight: FontWeight.bold)),
                          GestureDetector(onTap: () => _removeFromCart(item), child: const Icon(Icons.remove_circle, color: Colors.red, size: 18)),
                        ]),
                      ),
                    );
                  },
                ),
              ),

              // Discount
              Row(children: [
                const Text('Discount:'),
                Expanded(
                  child: Slider(value: _discount, max: _subtotal, divisions: 100,
                    onChanged: (v) => setState(() => _discount = v),
                    label: 'ETB ${_discount.toStringAsFixed(2)}',
                  ),
                ),
                Text('ETB ${_discount.toStringAsFixed(2)}'),
              ]),

              // Payment Method
              Row(children: [
                const Text('Payment:'),
                const SizedBox(width: 8),
                _paymentChip('cash', 'Cash'),
                _paymentChip('telebirr', 'Telebirr'),
                _paymentChip('cbe_birr', 'CBE Birr'),
              ]),

              // Totals
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Subtotal: ETB ${_subtotal.toStringAsFixed(2)}'),
                  Text('Tax (15%): ETB ${_tax.toStringAsFixed(2)}', style: const TextStyle(color: Colors.red)),
                  Text('Discount: -ETB ${_discount.toStringAsFixed(2)}', style: const TextStyle(color: Colors.orange)),
                ]),
                Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text('TOTAL: ETB ${_total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                  ElevatedButton.icon(
                    onPressed: _loading ? null : _checkout,
                    icon: const Icon(Icons.check),
                    label: const Text('Checkout'),
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 12)),
                  ),
                ]),
              ]),
            ]),
          ),
      ],
    );
  }

  Widget _paymentChip(String value, String label) {
    final selected = _paymentMethod == value;
    return GestureDetector(
      onTap: () => setState(() => _paymentMethod = value),
      child: Chip(
        label: Text(label, style: TextStyle(color: selected ? Colors.white : Colors.black, fontSize: 11)),
        backgroundColor: selected ? Colors.blue : Colors.grey[200],
        padding: EdgeInsets.zero,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
    );
  }
}