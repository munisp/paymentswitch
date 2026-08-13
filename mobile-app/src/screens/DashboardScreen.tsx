import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';

interface MetricData {
  label: string;
  value: string;
  change: string;
  positive: boolean | null;
}

interface RecentTransaction {
  id: string;
  type: string;
  amount: number;
  status: 'completed' | 'pending' | 'failed' | 'reversed';
  time: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  pending: '#f59e0b',
  failed: '#ef4444',
  reversed: '#8b5cf6',
};

export default function DashboardScreen() {
  const [metrics, setMetrics] = useState<MetricData[]>([]);
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/trpc/dashboard.getStats');
      if (!res.ok) throw new Error(`Live dashboard request failed with ${res.status}`);
      const data = await res.json();
      const result = data?.result?.data?.json ?? data?.result?.data;
      if (!result || !Array.isArray(result.metrics) || !Array.isArray(result.recentTransactions)) {
        throw new Error('Live dashboard response is incomplete');
      }
      setMetrics(result.metrics);
      setTransactions(result.recentTransactions);
    } catch (err) {
      setMetrics([]);
      setTransactions([]);
      setError(err instanceof Error ? err.message : 'Live dashboard data is unavailable');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563eb" />}
    >
      <Text style={styles.header}>NOC Dashboard</Text>
      <Text style={styles.subHeader}>Real-time payment switch overview</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Metrics Grid */}
      <View style={styles.metricsGrid}>
        {metrics.map((m) => (
          <View key={m.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{m.label}</Text>
            <Text style={styles.metricValue}>{m.value}</Text>
                          <Text style={[styles.metricChange, { color: m.positive === null ? '#6b7280' : m.positive ? '#10b981' : '#ef4444' }]}>

              {m.change}
            </Text>
          </View>
        ))}
      </View>

      {/* Recent Transactions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        {transactions.map((tx) => (
          <TouchableOpacity key={tx.id} style={styles.txRow} activeOpacity={0.7}>
            <View style={styles.txInfo}>
              <Text style={styles.txType}>{tx.type}</Text>
              <Text style={styles.txTime}>{tx.time}</Text>
            </View>
            <View style={styles.txRight}>
              <Text style={styles.txAmount}>₦{tx.amount.toLocaleString()}</Text>
              <View style={[styles.txStatus, { backgroundColor: STATUS_COLORS[tx.status] + '20' }]}>
                <Text style={[styles.txStatusText, { color: STATUS_COLORS[tx.status] }]}>
                  {tx.status}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
  header: { fontSize: 24, fontWeight: 'bold', color: '#111827', paddingHorizontal: 16, paddingTop: 16 },
  subHeader: { fontSize: 14, color: '#6b7280', paddingHorizontal: 16, marginBottom: 16 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  metricCard: {
    width: '46%', backgroundColor: '#fff', borderRadius: 12, padding: 16, margin: '2%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  metricLabel: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  metricValue: { fontSize: 22, fontWeight: 'bold', color: '#111827' },
  metricChange: { fontSize: 12, fontWeight: '500', marginTop: 4 },
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusLabel: { flex: 1, fontSize: 14, color: '#374151' },
  statusValue: { fontSize: 13, fontWeight: '500' },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  txInfo: { flex: 1 },
  txType: { fontSize: 14, fontWeight: '500', color: '#111827' },
  txTime: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontSize: 14, fontWeight: '600', color: '#111827' },
  txStatus: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  txStatusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  error: { color: '#b91c1c', backgroundColor: '#fee2e2', marginHorizontal: 16, marginTop: 12, borderRadius: 6, padding: 10, fontSize: 13 },
});
