import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { DonutChart, type ChartItem } from './DonutChart';
import { formatCurrency } from '../utils/formatters';
import { getShareMessage } from '../utils/shareMessages';

type ShareCardProps = {
  items: ChartItem[];
  annualDividend: number;
  dividendYield: number;
};

const CARD_WIDTH = 360;
const CHART_SIZE = 200;

export function ShareCard({ items, annualDividend, dividendYield }: ShareCardProps) {
  const monthlyDividend = annualDividend / 12;
  const message = getShareMessage(monthlyDividend);
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;

  return (
    <View style={styles.card}>
      <Text style={styles.message}>{message}</Text>

      <View style={styles.chartContainer}>
        <DonutChart items={items} size={CHART_SIZE} surfaceColor="#ffffff" />
      </View>

      <View style={styles.summaryContainer}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>年間配当金</Text>
          <Text style={styles.summaryValue}>{formatCurrency(annualDividend)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>配当利回り</Text>
          <Text style={styles.summaryValue}>{dividendYield.toFixed(2)}%</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.appIcon}
        />
        <Text style={styles.appName}>配当管理</Text>
        <Text style={styles.dateText}>{dateStr}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  message: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333333',
    textAlign: 'center',
    marginBottom: 16,
  },
  chartContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryContainer: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666666',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333333',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  appName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    flex: 1,
  },
  dateText: {
    fontSize: 12,
    color: '#999999',
  },
});
