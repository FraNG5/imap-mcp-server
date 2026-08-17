/**
 * IMAP MCP Server - HTTP Streamable Transport
 * 
 * Startet den imap-mcp-server als HTTP-Server,
 * damit er mit Vibe Web (oder anderen HTTP-MCP-Clients) verbunden werden kann.
 * 
 * VORAUSSETZUNG: Projekt muss gebaut sein (npm run build)
 * 
 * Verwendung:
 *   npx tsx start-http.ts
 *   ODER: npm run dev-http  (falls in package.json definiert)
 * 
 * Dann in Vibe Web als Connector eintragen:
 *   Server: http://localhost:3001
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

// Lade Umgebungsvariablen
dotenv.config();

// Importiere Services und Tools direkt aus den TypeScript-Sources
// tsx wandelt .ts automatisch in ausführbaren Code um
import { ImapService } from './src/services/imap-service.ts';
import { AccountManager } from './src/services/account-manager.ts';
import { SmtpService } from './src/services/smtp-service.ts';
import { SpamService } from './src/services/spam-service.ts';
import { registerTools } from './src/tools/index.ts';

// ============================================================================
// SERVER INITIALISIEREN
// ============================================================================

// Erstelle MCP-Server
const server = new McpServer({
  name: 'imap-mcp-server',
  version: '2.0.0',
});

// Initialisiere Services
const imapService = new ImapService();
const accountManager = new AccountManager();
const smtpService = new SmtpService();
const spamService = new SpamService();

// Verknüpfe Services
imapService.setAccountManager(accountManager);

// Registriere alle Tools
registerTools(server, imapService, accountManager, smtpService, spamService);

// Erstelle HTTP-Transport für Streamable HTTP
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

// Erstelle Node.js HTTP-Server
const httpServer = createServer((req, res) => {
  transport.handleRequest(req, res);
});

// Starte Server
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || 'localhost';

httpServer.listen(PORT, HOST, () => {
  const localUrl = `http://${HOST}:${PORT}`;
  const configPath = path.join(os.homedir(), '.imap-mcp', 'accounts.json');
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   📧 IMAP MCP Server (HTTP Streamable Transport)           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`✅ Server läuft auf: ${localUrl}`);
  console.log(`📁 Accounts: ${configPath}`);
  console.log('');
  console.log('📋 Vibe Web Konfiguration:');
  console.log('   Titel:          IMAP (HTTP)');
  console.log(`   Server:         ${localUrl}`);
  console.log('   Authentifizierung: Automatisch erkennen');
  console.log('   Sichtbarkeit:   Privat');
  console.log('');
  console.log('⌃C zum Beenden drücken');
  console.log('');
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Server wird heruntergefahren...');
  httpServer.close(() => {
    console.log('✅ Server erfolgreich beendet');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n👋 Server wird heruntergefahren (SIGTERM)...');
  httpServer.close(() => {
    console.log('✅ Server erfolgreich beendet');
    process.exit(0);
  });
});
