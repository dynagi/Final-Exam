import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, Screen, SectionTitle } from '../../components/UI';
import WebQrScanner from '../../components/WebQrScanner';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { scanCopy } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { radius, spacing, ThemeColors } from '../../lib/theme';
import { ExamCenter } from '../../lib/types';

interface ScanLog {
  ts: string;
  ok: boolean;
  text: string;
}

const IS_WEB = Platform.OS === 'web';

export default function InvigilatorScanScreen() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [center, setCenter] = useState<ExamCenter | null>(null);
  const [scanning, setScanning] = useState(true);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<ScanLog[]>([]);
  const [permission, requestPermission] = useCameraPermissions();
  const lastRef = useRef<{ data: string; at: number }>({ data: '', at: 0 });

  useEffect(() => {
    if (!profile) return;
    void supabase
      .from('exam_centers')
      .select('*')
      .eq('auth_user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => setCenter((data as ExamCenter | null) ?? null));
  }, [profile]);

  const submit = useCallback(
    async (payload: string) => {
      const text = payload.trim();
      if (!text || busy) return;
      setBusy(true);
      try {
        const res = await scanCopy(text);
        setLog((prev) => [
          {
            ts: new Date().toISOString(),
            ok: true,
            text: `Copy #${res.copy_number}${res.set_label ? ` ${res.set_label}` : ''} scanned in ✓`,
          },
          ...prev,
        ]);
      } catch (e) {
        setLog((prev) => [
          { ts: new Date().toISOString(), ok: false, text: e instanceof Error ? e.message : 'Scan failed' },
          ...prev,
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  // Stable scan handler so the camera doesn't restart every time `busy` flips.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const handleScan = useCallback((text: string) => {
    const now = Date.now();
    if (text === lastRef.current.data && now - lastRef.current.at < 3000) return;
    lastRef.current = { data: text, at: now };
    void submitRef.current(text);
  }, []);

  const reticle = <View style={styles.reticle} pointerEvents="none" />;

  return (
    <Screen scroll>
      <Card style={styles.centerCard}>
        <Text style={styles.centerName}>
          {center ? `${center.name} (${center.code})` : profile?.full_name ?? 'Center'}
        </Text>
        <Text style={styles.dim}>
          {center
            ? `Exam starts ${new Date(center.starts_at).toLocaleString()}`
            : 'Scan each paper’s QR to check it in. The admin is notified in real time.'}
        </Text>
      </Card>

      <SectionTitle title="Scan QR" />
      {IS_WEB ? (
        <>
          <View style={styles.cameraWrap}>
            {scanning ? (
              <View style={StyleSheet.absoluteFill}>
                <WebQrScanner onScan={handleScan} />
              </View>
            ) : (
              <View style={styles.cameraPaused}>
                <Ionicons name="pause-circle-outline" size={40} color={colors.textDim} />
              </View>
            )}
            {reticle}
          </View>
          <Text style={styles.hint}>Allow camera access when the browser asks. Point at the QR on the paper.</Text>
          <Button
            title={scanning ? 'Pause camera' : 'Resume camera'}
            variant="ghost"
            icon={scanning ? 'pause' : 'play'}
            onPress={() => setScanning((s) => !s)}
            style={{ marginTop: spacing.sm }}
          />
        </>
      ) : !permission?.granted ? (
        <Card>
          <Text style={styles.dim}>Camera access is needed to scan the paper QR codes.</Text>
          <Button title="Grant camera access" icon="camera-outline" onPress={() => void requestPermission()} style={{ marginTop: spacing.md }} />
        </Card>
      ) : (
        <>
          <View style={styles.cameraWrap}>
            {scanning ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => handleScan(data)}
              />
            ) : (
              <View style={styles.cameraPaused}>
                <Ionicons name="pause-circle-outline" size={40} color={colors.textDim} />
              </View>
            )}
            {reticle}
          </View>
          <Button
            title={scanning ? 'Pause scanner' : 'Resume scanner'}
            variant="ghost"
            icon={scanning ? 'pause' : 'play'}
            onPress={() => setScanning((s) => !s)}
            style={{ marginTop: spacing.sm }}
          />
        </>
      )}

      <SectionTitle title="Or paste a QR payload" />
      <Card>
        <Input
          label="QR payload"
          placeholder='{"c":"…","p":"…","n":1,"sig":"…"}'
          value={manual}
          onChangeText={setManual}
          autoCapitalize="none"
          multiline
        />
        <Button
          title="Submit scan"
          icon="checkmark-done-outline"
          loading={busy}
          onPress={() => {
            void submit(manual);
            setManual('');
          }}
        />
      </Card>

      <SectionTitle title="This session" />
      {log.length === 0 ? (
        <Card>
          <Text style={styles.dim}>Scans you check in will appear here.</Text>
        </Card>
      ) : (
        log.map((entry, i) => (
          <Card key={i} style={styles.logRow}>
            <Ionicons
              name={entry.ok ? 'checkmark-circle' : 'close-circle'}
              size={18}
              color={entry.ok ? colors.success : colors.danger}
            />
            <Text style={[styles.logText, { color: entry.ok ? colors.text : colors.danger }]}>
              {entry.text}
            </Text>
            <Text style={styles.dim}>{timeAgo(entry.ts)}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    dim: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
    hint: { color: colors.textDim, fontSize: 12, marginTop: spacing.sm },
    centerCard: { backgroundColor: colors.primarySoft, borderColor: `${colors.primary}44` },
    centerName: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 4 },
    cameraWrap: {
      height: 280,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: '#000',
      justifyContent: 'center',
      alignItems: 'center',
    },
    cameraPaused: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    reticle: {
      width: 180,
      height: 180,
      borderWidth: 3,
      borderColor: colors.accent,
      borderRadius: radius.lg,
      opacity: 0.9,
    },
    logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    logText: { flex: 1, fontSize: 13, fontWeight: '600' },
  });
