import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static const String baseUrl = 'http://localhost:3000/api';
  
  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('token');
  }
  
  static Future<Map<String, String>> getHeaders() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ${token ?? ''}',
    };
  }
  
  // Login
  static Future<Map<String, dynamic>> login(String phone, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'phone': phone, 'password': password}),
    );
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('token', data['token']);
      await prefs.setString('userName', data['user']['name']);
      return {'success': true, 'data': data};
    }
    return {'success': false, 'error': jsonDecode(response.body)['error']};
  }
  
  // Register
  static Future<Map<String, dynamic>> register(
    String businessName, String ownerName, String phone, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'business_name': businessName,
        'owner_name': ownerName,
        'phone': phone,
        'password': password,
      }),
    );
    
    if (response.statusCode == 201) {
      final data = jsonDecode(response.body);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('token', data['token']);
      return {'success': true, 'data': data};
    }
    return {'success': false, 'error': jsonDecode(response.body)['error']};
  }
  
  // Get Products
  static Future<List<dynamic>> getProducts() async {
    final headers = await getHeaders();
    final response = await http.get(
      Uri.parse('$baseUrl/products'),
      headers: headers,
    );
    
    if (response.statusCode == 200) {
      return jsonDecode(response.body)['products'];
    }
    return [];
  }
  
  // Add Product
  static Future<bool> addProduct(Map<String, dynamic> product) async {
    final headers = await getHeaders();
    final response = await http.post(
      Uri.parse('$baseUrl/products'),
      headers: headers,
      body: jsonEncode(product),
    );
    return response.statusCode == 201;
  }
  
  // Make Sale
  static Future<Map<String, dynamic>> makeSale(Map<String, dynamic> sale) async {
    final headers = await getHeaders();
    final response = await http.post(
      Uri.parse('$baseUrl/sales'),
      headers: headers,
      body: jsonEncode(sale),
    );
    
    if (response.statusCode == 201) {
      return {'success': true, 'data': jsonDecode(response.body)};
    }
    return {'success': false, 'error': jsonDecode(response.body)['error']};
  }
  
  // Logout
  static Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('userName');
  }
  
  static Future<bool> isLoggedIn() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }
}
