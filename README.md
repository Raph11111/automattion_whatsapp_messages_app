# 📱 WhatsApp Message Scheduler (WA Scheduler)

Une application web complète pour programmer l'envoi automatique de messages WhatsApp (textes, médias avec légendes, sondages, messages récurrents).

## 🚀 Démarrage rapide (Schnellstart)

### 1. Par double-clic (Windows)
Double-cliquez simplement sur le fichier **`start.bat`**. Le serveur démarrera et votre navigateur s'ouvrira automatiquement sur `http://localhost:3000`.

### 2. En ligne de commande (Terminal)
```bash
npm start
```
Puis ouvrez votre navigateur sur [http://localhost:3000](http://localhost:3000).

---

## 📲 Connexion WhatsApp

1. Lors du premier lancement, un **QR Code** s'affiche sur la page web.
2. Ouvrez WhatsApp sur votre smartphone > **Appareils connectés** > **Connecter un appareil**.
3. Scannez le QR Code.
4. Une fois connecté, la session est sauvegardée localement (`LocalAuth`). Vous n'aurez plus besoin de scanner le QR code à chaque démarrage.

---

## 🛠️ Fonctionnalités

- 📝 **Messages texte** programmés à date/heure précise
- 🖼️ **Médias** : images, vidéos, fichiers audio, documents avec légende
- 📊 **Sondages** : questions personnalisées avec options multiples
- 🔁 **Messages récurrents** : quotidien, hebdomadaire, mensuel
- 📋 **Gestion des programmations** : liste des messages prévus, historique et statut en temps réel
