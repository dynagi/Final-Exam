/**
 * The Admin's book index — one entry per screen in AdminTabs.
 *
 * The command centre has the deepest index in the app; keeping it in one place
 * means the rail cannot drift out of step with the navigator's routes.
 */
import { useNavigation } from '@react-navigation/native';
import { useCallback, useMemo } from 'react';
import { IndexItem } from '../../components/ArchiveBook';

export function useAdminIndex(options: {
  /** Route name of the screen calling this, so it can mark itself active. */
  active: string;
  /** Called before navigating — used to close the mobile index overlay. */
  onBeforeSelect?: () => void;
}): { items: IndexItem[]; onSelect: (item: IndexItem) => void } {
  const { active, onBeforeSelect } = options;
  const navigation = useNavigation();

  const items = useMemo<IndexItem[]>(
    () => [
      { route: 'AdminDashboard', label: 'Dashboard', icon: 'home' },
      { route: 'AdminOverview', label: 'Overview', icon: 'bar-chart-outline' },
      { route: 'Approvals', label: 'Approvals', icon: 'person-add-outline' },
      { route: 'Papers', label: 'Papers', icon: 'documents-outline' },
      { route: 'PrintPreview', label: 'Print', icon: 'print-outline' },
      { route: 'Exams', label: 'Exams', icon: 'calendar-outline' },
      { route: 'Centers', label: 'Centers', icon: 'business-outline' },
      { route: 'Custody', label: 'Custody', icon: 'location-outline' },
      { route: 'Detections', label: 'Detections', icon: 'scan-outline' },
      { route: 'Audit', label: 'Audit', icon: 'reader-outline' },
    ],
    []
  );

  const onSelect = useCallback(
    (item: IndexItem) => {
      onBeforeSelect?.();
      if (item.route === active) return;
      (navigation as unknown as { navigate: (s: string) => void }).navigate(item.route);
    },
    [active, navigation, onBeforeSelect]
  );

  return { items, onSelect };
}
