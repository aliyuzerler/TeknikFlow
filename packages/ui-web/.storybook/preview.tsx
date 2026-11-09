import type { Preview } from '@storybook/react';
import '@fontsource-variable/inter';
import '@teknikflow/design-tokens/tokens.css';
import '../src/ui-web.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'canvas',
      values: [
        { name: 'canvas', value: '#F5F7FA' },
        { name: 'surface', value: '#FFFFFF' },
      ],
    },
  },
};

export default preview;
