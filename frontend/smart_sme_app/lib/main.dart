import 'package:flutter/material.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'services/api_service.dart';

void main() {
  runApp(const SmartSMEApp());
}

class SmartSMEApp extends StatelessWidget {
  const SmartSMEApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Smart SME Manager',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primarySwatch: Colors.blue,
        useMaterial3: true,
      ),
      home: FutureBuilder<bool>(
        future: ApiService.isLoggedIn(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          return snapshot.data == true ? const HomeScreen() : const LoginScreen();
        },
      ),
    );
  }
}
