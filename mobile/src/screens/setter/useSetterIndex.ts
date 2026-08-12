/**
 * The paper setter's book index — one entry per screen in SetterTabs.
 *
 * Shared by every setter page so the rail is identical wherever you are:
 * same order, same numbering, same behaviour. Adding a tab to SetterTabs
 * means adding it here once, not on each screen.
 */
import { useNavigation } from '@react-navigation/native';
import { useCallback, useMemo } from 'react';
import { IndexItem } from '../../components/ArchiveBook';

export interface SetterIndex {
  items: IndexItem[];
  onSelect: (item: IndexItem) => void;
}

export function useSetterIndex(options: {
  /** Route name of the screen calling this, so it can mark itself active. */
  active: string;
  /**
   * Screens that can preview the thing they are showing pass a handler; the
   * rest fall through to My Papers, which is where per-paper preview lives.
   */
  onPreview?: () => void;
  previewDisabled?: boolean;
  /** Called before navigating — used to close the mobile index overlay. */
  onBeforeSelect?: () => void;
}): SetterIndex {
  const { active, onPreview, previewDisabled, onBeforeSelect } = options;
  const navigation = useNavigation();

  const items = useMemo<IndexItem[]>(
    () => [
      { route: 'SetterDashboard', label: 'Dashboard', icon: 'home' },
      { route: 'QuestionPool', label: 'Pool', icon: 'library-outline' },
      { route: 'Compose', label: 'Compose', icon: 'create-outline' },
      { route: 'MyPapers', label: 'My Papers', icon: 'documents-outline' },
      {
        route: 'Preview',
        label: 'Preview',
        icon: 'eye-outline',
        action: onPreview,
        disabled: !!onPreview && !!previewDisabled,
      },
    ],
    [onPreview, previewDisabled]
  );

  const onSelect = useCallback(
    (item: IndexItem) => {
      onBeforeSelect?.();
      if (item.action) {
        item.action();
        return;
      }
      // Preview has no screen of its own; My Papers is where a paper is
      // previewed and confirmed.
      const target = item.route === 'Preview' ? 'MyPapers' : item.route;
      if (target === active) return;
      (navigation as unknown as { navigate: (s: string) => void }).navigate(target);
    },
    [active, navigation, onBeforeSelect]
  );

  return { items, onSelect };
}
