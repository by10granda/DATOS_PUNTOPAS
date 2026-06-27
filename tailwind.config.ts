import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        corporateRed: '#ff0000',
        corporateGreen: '#25ff00',
        corporateBlue: '#102d84',
        softBg: '#f5f5f5'
      },
      boxShadow: {
        card: '0 12px 30px rgba(16, 45, 132, 0.12)'
      }
    }
  },
  plugins: []
} satisfies Config;
