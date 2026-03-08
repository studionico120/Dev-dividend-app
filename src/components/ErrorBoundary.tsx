import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Ionicons name="warning-outline" size={72} color="#ef5350" />
          <Text style={styles.title}>予期しないエラーが発生しました</Text>
          <Text style={styles.description}>
            アプリの再起動をお試しください。{'\n'}
            問題が続く場合はサポートまでご連絡ください。
          </Text>
          {__DEV__ && this.state.errorMessage ? (
            <Text style={styles.devError}>{this.state.errorMessage}</Text>
          ) : null}
          <TouchableOpacity style={styles.retryBtn} onPress={this.handleRetry} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>再試行</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  title: {
    color: '#e0e0e0',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  description: {
    color: '#9e9e9e',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  devError: {
    color: '#ef5350',
    fontSize: 11,
    textAlign: 'center',
    backgroundColor: '#2a1a1e',
    padding: 12,
    borderRadius: 8,
    fontFamily: 'monospace',
    maxWidth: '100%',
  },
  retryBtn: {
    backgroundColor: '#4fc3f7',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  retryBtnText: {
    color: '#1a1a2e',
    fontSize: 16,
    fontWeight: '700',
  },
});
