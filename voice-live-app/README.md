# 🎤 Voice Live Masking App

Applicazione per voice masking in tempo reale usando **Azure Voice Live API** per speech-to-speech diretto.

## 📋 Requisiti

- Node.js v16 o superiore
- Azure Speech Services API Key con accesso a Voice Live API
- Browser moderno con supporto WebRTC

## 🚀 Installazione e Avvio

1. **Installa le dipendenze:**
   ```bash
   npm install
   ```

2. **Avvia il server:**
   ```bash
   npm start
   ```

3. **Apri il browser:**
   Vai su `http://localhost:3000`

## 🔧 Configurazione

1. **Ottieni una API Key Azure Speech:**
   - Vai su [Azure Portal](https://portal.azure.com)
   - Crea una risorsa "Speech Services"
   - Assicurati che sia abilitata per Voice Live API
   - Copia la API Key dalla sezione "Keys and Endpoint"

2. **Configura l'applicazione:**
   - Inserisci la tua API Key nel campo apposito
   - Clicca "Start Recording" per iniziare
   - Parla nel microfono
   - Clicca "Process Audio" per processare l'audio o attendi il rilevamento automatico del silenzio

## 🎯 Come Funziona

1. **Input Audio:** L'applicazione cattura l'audio dal microfono in tempo reale
2. **Streaming:** Invia l'audio direttamente alla Azure Voice Live API via WebSocket
3. **Speech-to-Speech:** Azure processea l'audio utilizzando la Voice Live API per conversione vocale diretta
4. **Output:** Riceve e riproduce l'audio trasformato in tempo reale

**🔥 Caratteristica Chiave:** Nessuna conversione STT→TTS! Utilizza la nuova Azure Voice Live API per trasformazione vocale diretta.

## 🎛️ Controlli

- **Start/Stop Recording:** Avvia e ferma la sessione di registrazione
- **Process Audio:** Forza l'elaborazione dell'audio accumulato
- **Volume Input:** Controlla il volume del microfono
- **Volume Output:** Controlla il volume dell'audio trasformato
- **Visualizzatore:** Mostra l'attività audio in tempo reale
- **Log:** Monitora lo stato della connessione e gli eventi

## ⚡ Funzionalità Avanzate

- **Rilevamento Automatico del Silenzio:** L'app rileva automaticamente quando smetti di parlare
- **Buffering Intelligente:** Accumula l'audio e lo processa quando rileva una pausa
- **Elaborazione in Tempo Reale:** Utilizza WebSocket per latenza minima
- **Visualizzazione Audio:** Mostra l'attività del microfono in tempo reale

## 📁 Struttura del Progetto

```
voice-live-app/
├── server.js          # Backend Node.js con WebSocket
├── index.html         # Interfaccia utente
├── style.css          # Stili CSS
├── client.js          # Logica frontend
├── package.json       # Dipendenze Node.js
└── README.md          # Documentazione
```

## 🔒 Sicurezza

- L'API Key viene trasmessa solo tra client e server locale
- Nessuna autenticazione Entra ID richiesta
- Connessione sicura con Azure tramite WebSocket

## 🐛 Risoluzione Problemi

### Errore "API Key required"
- Verifica di aver inserito una API Key valida

### Errore microfono
- Controlla i permessi del browser per l'accesso al microfono
- Assicurati che il microfono sia funzionante

### Connessione Azure fallita
- Verifica la validità della API Key
- Controlla la connessione internet
- Verifica che la regione Azure sia corretta (attualmente: West Europe)

### Audio non riprodotto
- Controlla il volume output
- Verifica che gli altoparlanti siano funzionanti
- Controlla la console del browser per errori

## 🔧 Sviluppo

Per sviluppo con auto-reload:
```bash
npm run dev
```

## 📝 Note Tecniche

- **Sample Rate:** 16kHz per input e output
- **Formato Audio:** PCM 16-bit
- **Voce Neurale:** it-IT-DiegoNeural
- **Latenza:** ~200-500ms (dipende dalla connessione)

## 🌐 Browser Supportati

- Chrome/Chromium 88+
- Firefox 85+
- Safari 14+
- Edge 88+

## 📜 Licenza

MIT License - Vedi file LICENSE per dettagli.
