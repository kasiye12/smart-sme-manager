import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'pos_screen.dart';
import 'inventory_screen.dart';
import 'customers_screen.dart';
import 'reports_screen.dart';
import 'login_screen.dart';
import '../services/api_service.dart';
import 'expenses_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;
  String _userName = '';
  String _businessName = '';

  final List<Widget> _screens = [
    const POSScreen(),
    const InventoryScreen(),
    const CustomersScreen(),
    const ReportsScreen(),
    const ExpensesScreen(),
  ];

  final List<String> _titles = [
    'Point of Sale',
    'Inventory',
    'Customers',
    'Reports',
    'Expenses',
  ];

  @override
  void initState() {
    super.initState();
    _loadUserInfo();
  }

  Future<void> _loadUserInfo() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _userName = prefs.getString('userName') ?? 'User';
      _businessName = prefs.getString('businessName') ?? '';
    });
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Logout'),
        content: const Text('Are you sure you want to logout?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Logout', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await ApiService.logout();
      if (mounted) {
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const LoginScreen()),
          (route) => false,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.blue,
        foregroundColor: Colors.white,
        elevation: 2,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_titles[_currentIndex], style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            if (_businessName.isNotEmpty)
              Text(_businessName, style: const TextStyle(fontSize: 12, color: Colors.white70)),
          ],
        ),
        actions: [
          // User info
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Row(
              children: [
                const Icon(Icons.person, size: 20),
                const SizedBox(width: 4),
                Text(_userName, style: const TextStyle(fontSize: 14)),
              ],
            ),
          ),
          // Logout button
          IconButton(
            icon: const Icon(Icons.logout, color: Colors.white),
            onPressed: _logout,
            tooltip: 'Logout',
          ),
        ],
      ),
      
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          boxShadow: [
            BoxShadow(color: Colors.grey.withOpacity(0.3), blurRadius: 10, offset: const Offset(0, -2)),
          ],
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (index) => setState(() => _currentIndex = index),
          type: BottomNavigationBarType.fixed,
          selectedItemColor: Colors.blue,
          unselectedItemColor: Colors.grey,
          selectedFontSize: 12,
          unselectedFontSize: 11,
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.point_of_sale),
              activeIcon: Icon(Icons.point_of_sale, color: Colors.blue),
              label: 'POS',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.inventory),
              activeIcon: Icon(Icons.inventory, color: Colors.blue),
              label: 'Products',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.people),
              activeIcon: Icon(Icons.people, color: Colors.blue),
              label: 'Customers',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.analytics),
              activeIcon: Icon(Icons.analytics, color: Colors.blue),
              label: 'Reports',
            ),
                const BottomNavigationBarItem(icon: Icon(Icons.money_off), label: 'Expenses'),
          ],
        ),
      ),
    );
  }
}