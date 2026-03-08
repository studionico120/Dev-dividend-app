import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { ShareCard } from './ShareCard';
import type { ChartItem } from './DonutChart';
import type { Theme } from '../contexts/ThemeContext';

type ShareModalProps = {
  visible: boolean;
  onClose: () => void;
  items: ChartItem[];
  annualDividend: number;
  dividendYield: number;
  theme: Theme;
};

export function ShareModal({
  visible,
  onClose,
  items,
  annualDividend,
  dividendYield,
  theme,
}: ShareModalProps) {
  const cardRef = useRef<View>(null);
  const [isBusy, setIsBusy] = useState(false);

  const capture = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    try {
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
      });
      return uri;
    } catch {
      Alert.alert('エラー', '画像の作成に失敗しました');
      return null;
    }
  };

  const handleShare = async () => {
    setIsBusy(true);
    try {
      const uri = await capture();
      if (!uri) return;
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = async () => {
    setIsBusy(true);
    try {
      const uri = await capture();
      if (!uri) return;
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('保存完了', '画像をカメラロールに保存しました');
    } catch {
      Alert.alert('エラー', '画像の保存に失敗しました。設定から写真へのアクセスを許可してください。');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: theme.surface }]}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>シェアプレビュー</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.previewContainer}
            showsVerticalScrollIndicator={false}
          >
            <View ref={cardRef} collapsable={false}>
              <ShareCard
                items={items}
                annualDividend={annualDividend}
                dividendYield={dividendYield}
              />
            </View>
          </ScrollView>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.accent }]}
              onPress={handleShare}
              disabled={isBusy}
              activeOpacity={0.8}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="share-social-outline" size={18} color="#ffffff" />
                  <Text style={styles.buttonText}>シェアする</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.saveButton, { borderColor: theme.accent }]}
              onPress={handleSave}
              disabled={isBusy}
              activeOpacity={0.8}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color={theme.accent} />
                  <Text style={[styles.buttonText, { color: theme.accent }]}>画像を保存</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    borderRadius: 20,
    padding: 20,
    maxHeight: '85%',
    width: '100%',
    maxWidth: 400,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  previewContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
  },
  saveButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
