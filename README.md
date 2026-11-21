# LeakLens – The Friend Who Checks Your Photo Before the World Does!

AI photo privacy checker for teens · hridhAI 2026 · SR1 AI That Protects.
Works on phones and computers, installs like an app, and checks photos **on the device** (photos are never uploaded).

## Folder layout

```
leaklens/
├── index.html      ← the page (screens and buttons)
├── styles.css      ← design (phone + desktop)
├── manifest.json   ← makes it installable as an app
├── sw.js           ← offline support
├── icon.svg        ← app icon
└── js/
    ├── app.js      ← main logic: scan → score → fix → save
    ├── exif.js     ← reads hidden GPS / phone model / time from the photo file
    ├── vision.js   ← AI face detection + optional Teachable Machine school-logo model
    ├── ocr.js      ← AI text reading (Tesseract OCR)
    ├── pii.js      ← decides which text is personal (phone, plate, house no., name …)
    ├── score.js    ← privacy score 0–100
    ├── blur.js     ← blur
    ├── sample.js   ← demo photo with hidden GPS (approx. Kanha Shanti Vanam)
    └── i18n.js     ← English / Hindi / Telugu text
```

The AI libraries and models (face-api.js, Tesseract.js) download automatically from the jsdelivr CDN the first time, then are cached.

## Run on your computer

```bash
cd leaklens
python -m http.server 8000
```
Open http://localhost:8000 and click **Try the sample photo**. (Double-clicking index.html will not work – use a local server.)

## Put it online free (GitHub Pages)

1. github.com → New repository `leaklens` (Public).
2. *Add file → Upload files* → drag in all files **and the js folder** → Commit.
3. *Settings → Pages* → Branch: `main`, folder `/ (root)` → Save.
4. In 1–2 minutes it is live at `https://<username>.github.io/leaklens/`.
5. Phones: open the link → **Install app** (Android) or *Share → Add to Home Screen* (iPhone).

## School logo model (optional)

teachablemachine.withgoogle.com → Image Project → Class 1 = `School logo` (50+ photos), Class 2 = `Background` (100+ photos) → Train → Export → TensorFlow.js → Download. In LeakLens: ⚙ Settings → choose `model.json`, `weights.bin`, `metadata.json` together.

## Credits

face-api.js (MIT), Tesseract.js (Apache-2.0), TensorFlow.js (Apache-2.0), Google Teachable Machine. Code drafted with help from Claude (Anthropic) and tested by the team – edit to describe exactly how your team used AI tools.
