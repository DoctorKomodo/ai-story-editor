import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import '../src/index.css';

const ThemeDecorator: Decorator = (Story, context) => {
  const theme = (context.globals.theme as string | undefined) ?? 'paper';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <Story />;
};

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    layout: 'centered',
  },
  globalTypes: {
    theme: {
      description: 'Inkwell theme',
      defaultValue: 'paper',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'paper', title: 'Paper' },
          { value: 'sepia', title: 'Sepia' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [ThemeDecorator],
};

export default preview;
