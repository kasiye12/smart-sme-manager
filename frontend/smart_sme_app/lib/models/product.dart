class Product {
  final String id;
  final String name;
  final double costPrice;
  final double sellingPrice;
  int stock;
  int quantity;
  
  Product({
    required this.id,
    required this.name,
    required this.costPrice,
    required this.sellingPrice,
    required this.stock,
    this.quantity = 0,
  });
  
  double get total => sellingPrice * quantity;
  
  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'],
      name: json['name_translations'] is Map 
          ? (json['name_translations']['en'] ?? json['name_translations']['am'] ?? '')
          : json['name_translations']?.toString() ?? '',
      costPrice: double.parse(json['cost_price'].toString()),
      sellingPrice: double.parse(json['selling_price'].toString()),
      stock: int.parse(json['current_stock'].toString()),
    );
  }
}
