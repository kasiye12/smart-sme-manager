import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'core/constants/app_constants.dart';
import 'core/theme/app_theme.dart';
import 'core/i18n/app_localizations.dart';
import 'core/services/local_database.dart';
import 'core/services/sync_service.dart';
import 'core/services/auth_service.dart';

import 'features/auth/providers/auth_provider.dart';
import 'features/pos/providers/pos_provider.dart';
import 'features/inventory/providers/inventory_provider.dart';
import 'features/customers/providers/customer_provider.dart';
import 'features/reports/providers/report_provider.dart';

import 'routes/app_router.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize Hive for local storage
  await Hive.initFlutter();
  
  // Initialize local database
  await LocalDatabase.instance.database;
  
  // Initialize services
  await AuthService.init();
  await SyncService.init();
  
  runApp(const SmartSMEApp());
}

class SmartSMEApp extends StatelessWidget {
  const SmartSMEApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => POSProvider()),
        ChangeNotifierProvider(create: (_) => InventoryProvider()),
        ChangeNotifierProvider(create: (_) => CustomerProvider()),
        ChangeNotifierProvider(create: (_) => ReportProvider()),
      ],
      child: Consumer<AuthProvider>(
        builder: (context, authProvider, child) {
          return MaterialApp(
            title: 'Smart SME Manager',
            debugShowCheckedModeBanner: false,
            
            // Theme
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: ThemeMode.light,
            
            // Localization
            locale: authProvider.currentLocale,
            supportedLocales: const [
              Locale('en'),
              Locale('am'),
              Locale('or'),
              Locale('ti'),
            ],
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            
            // Routing
            initialRoute: authProvider.isAuthenticated 
                ? AppRouter.dashboard 
                : AppRouter.login,
            onGenerateRoute: AppRouter.generateRoute,
          );
        },
      ),
    );
  }
}