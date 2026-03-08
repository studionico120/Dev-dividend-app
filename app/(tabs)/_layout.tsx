import { Tabs, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/contexts/ThemeContext';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function makeTabBarIcon(name: IoniconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
}

export default function TabLayout() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const headerRight = () => (
    <TouchableOpacity
      onPress={() => router.push('/stock/add')}
      style={{ marginRight: 16 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="add-circle-outline" size={26} color={theme.accent} />
    </TouchableOpacity>
  );

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          paddingBottom: insets.bottom,
          height: 56 + insets.bottom,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarLabelStyle: { fontSize: 11 },
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'ホーム',
          tabBarIcon: makeTabBarIcon('home'),
          headerRight,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: 'ポートフォリオ',
          tabBarIcon: makeTabBarIcon('pie-chart'),
          headerRight,
        }}
      />
      <Tabs.Screen
        name="goal"
        options={{
          title: '目標',
          tabBarIcon: makeTabBarIcon('trophy-outline'),
          headerRight,
        }}
      />
      <Tabs.Screen
        name="stocks"
        options={{
          title: '銘柄一覧',
          tabBarIcon: makeTabBarIcon('list'),
          headerRight,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '設定',
          tabBarIcon: makeTabBarIcon('settings'),
        }}
      />
    </Tabs>
  );
}
