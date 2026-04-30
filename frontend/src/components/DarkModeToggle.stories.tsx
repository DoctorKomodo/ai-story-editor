import type { Meta, StoryObj } from '@storybook/react-vite';
import { DarkModeToggle } from './DarkModeToggle';

/**
 * NOTE: `DarkModeToggle` flips `data-theme="dark"` on `<html>` directly via
 * `useDarkMode`. That conflicts with the global theme toolbar decorator —
 * clicking the toggle in any story will hard-set or clear `data-theme`,
 * overriding the toolbar value. Both stories below render the same component;
 * the difference is the *initial* localStorage state before mount, which
 * Storybook can't easily seed without a custom decorator. So both stories are
 * functionally identical and the user verifies dark/light by clicking the
 * toggle and observing the rest of the page.
 */
const meta = {
  title: 'Components/DarkModeToggle',
  component: DarkModeToggle,
} satisfies Meta<typeof DarkModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
