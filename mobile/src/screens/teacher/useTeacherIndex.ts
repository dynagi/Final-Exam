/**
 * The teacher's book index — one entry per screen in TeacherTabs.
 *
 * Teachers write and track questions; composing, the pool and paper sets
 * belong to the paper setter, so those entries deliberately do not appear
 * here. Adding a tab to TeacherTabs means adding it here once.
 */
import { useNavigation } from '@react-navigation/native';
import { useCallback, useMemo } from 'react';
import { IndexItem } from '../../components/ArchiveBook';

export function useTeacherIndex(options: {
  /** Route name of the screen calling this, so it can mark itself active. */
  active: string;
  /** Called before navigating — used to close the mobile index overlay. */
  onBeforeSelect?: () => void;
}): { items: IndexItem[]; onSelect: (item: IndexItem) => void } {
  const { active, onBeforeSelect } = options;
  const navigation = useNavigation();

  const items = useMemo<IndexItem[]>(
    () => [
      { route: 'TeacherDashboard', label: 'Dashboard', icon: 'home' },
      { route: 'Upload', label: 'Upload', icon: 'cloud-upload-outline' },
      { route: 'MyQuestions', label: 'My Questions', icon: 'list-outline' },
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
