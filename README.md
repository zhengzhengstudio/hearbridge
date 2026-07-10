# HearBridge / 声桥

HearBridge is a lightweight H5 communication assistant prototype for deaf and hard-of-hearing people. It focuses on everyday face-to-face communication: live captions, typed speech, large text cards, reusable phrase cards, and vibration reminders.

声桥是一个面向听障人士的 H5 沟通辅助原型，来自一次真实访谈后的快速产品化尝试。它优先解决面对面沟通、医院口罩场景、工作文字确认、常用语表达和手机震动提醒这些高频需求。

## Features

- Multi-page H5 experience: communication desk, challenge training, local training, communication passport, and reminders.
- Live caption panel using the browser `SpeechRecognition` API when available.
- Typed speech and large text display for moments when speech recognition is unreliable.
- Phrase cards for hospital visits, transit, work, shopping, slower speech requests, and emergencies.
- Challenge levels for hospital, transit, work, shopping, and emergency scenes, with local XP and sample saving.
- No-key local mode with manual caption capture, recording samples, hotwords, and correction pairs for future personalization.
- Local reminder list with optional vibration test on supported devices.
- Privacy-first prototype: audio stays local by default; optional server transcription can be enabled with a backend API key.
- Standalone Express static server for PM2, Docker, or simple Node.js hosting.

## Quick Start

```bash
npm install
npm start
```

Then open:

```text
http://localhost:8118
```

Use a different port:

```bash
PORT=3000 npm start
```

Serve a custom static root:

```bash
HEAR_ROOT=/path/to/public HEAR_PORT=8118 npm start
```

Optional server-side transcription can be enabled by setting `OPENAI_API_KEY` in the Node.js server environment. When configured, the “录音转文字” fallback uploads the current recording to `/api/transcribe` and returns a caption. The key is read only by the Node.js server and is never exposed to the H5 frontend. If the key is missing, HearBridge keeps the recording as a local training sample and tells the user that cloud transcription is not configured.

## PM2

```bash
pm2 start server.js --name hearbridge --cwd "$(pwd)" --update-env
pm2 save
```

## Project Structure

```text
.
├── public/
│   ├── index.html
│   ├── challenge.html
│   ├── training.html
│   ├── passport.html
│   ├── reminders.html
│   ├── style.css
│   ├── app.js
│   ├── challenge.js
│   ├── training.js
│   ├── passport.js
│   ├── reminders.js
│   └── favicon.svg
├── server.js
├── package.json
├── LICENSE
└── README.md
```

## Browser Notes

Live captions depend on browser support for `window.SpeechRecognition` or `window.webkitSpeechRecognition`. Some mobile browsers return `network` when their online speech service is unreachable. In that case, HearBridge shows a recording fallback. Without an API key, users can still save recording samples, manually add captions, and build a local hotword list for names, medicines, addresses, and project terms.

Vibration depends on the browser and device support for `navigator.vibrate`.

## Safety And Scope

HearBridge is an assistive communication prototype. It does not replace hearing aids, cochlear implants, medical diagnosis, emergency response systems, or professional interpretation services.

## License

MIT
