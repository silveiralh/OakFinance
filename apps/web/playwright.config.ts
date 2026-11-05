import { defineConfig, devices } from '@playwright/test';

// Literal da tech §8.4, com testDir explícito e o mock da Pluggy rodando a partir da raiz.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: true,
  failOnFlakyTests: true, // um teste que só passa na repetição reprova o job
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } }, // Chromium: único onde o Playwright suporta Service Worker
    { name: 'iphone', use: { ...devices['iPhone 15'] } }, // WebKit
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter web preview --port 4173',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
    { command: 'deno run -A scripts/mock-pluggy.ts', port: 54400, cwd: '../..' },
  ],
});
