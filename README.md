# Google Speech-to-Text API Testing Project

This project provides a simple way to test both V1 and V2 versions of the Google Cloud Speech-to-Text API through a local proxy server.

## Features

- Test both V1 and V2 Google Speech-to-Text APIs
- Works behind a firewall using a local proxy (http://127.0.0.1:8888)
- Record audio directly from microphone
- Upload audio files for processing
- Select different recognition models
- Debug mode for troubleshooting
- Visualize audio input levels

## Project Structure

```
@speech/
├── backend/             # Node.js proxy server
│   ├── package.json     # Dependencies
│   └── server.js        # Server code
├── frontend/            # Web interface
│   ├── index.html       # HTML interface
│   └── script.js        # Frontend JavaScript
└── README.md            # This file
```

## Setup Instructions

### 1. Install Backend Dependencies

```bash
cd @speech/backend
npm install
```

### 2. Start the Server

```bash
cd @speech/backend
node server.js
```

The server will start on port 3000 by default.

### 3. Access the Web Interface

Open your browser and navigate to:
```
http://localhost:3000
```

## Using the Application

1. **Enter your Google Cloud API Key**
   - The key will be saved in your browser's local storage for convenience

2. **Select API Version**
   - Choose between V1 and V2 API tabs

3. **Configure Recognition Settings**
   - Select language
   - Choose recognition model

4. **Record or Upload Audio**
   - Click "Start Recording" to use your microphone
   - Or select an audio file and click "Upload File"

5. **View Results**
   - The transcript will appear in the results section
   - Confidence score is displayed when available

6. **Debug Mode**
   - Toggle "Debug Mode" to see detailed request/response information

## Troubleshooting

### Common Issues

1. **"Failed to fetch" Error**
   - Check that your local proxy (http://127.0.0.1:8888) is running
   - Verify that your API key has the necessary permissions

2. **V2 API Not Working**
   - Make sure you've enabled the Speech-to-Text V2 API in Google Cloud Console
   - Check that your API key has access to the V2 API

3. **No Audio Detected**
   - Check that your microphone is working
   - Try using a different browser

### Enabling the V2 API

1. Go to the Google Cloud Console
2. Navigate to "APIs & Services" > "Library"
3. Search for "Speech-to-Text"
4. Enable the V2 API

## API Key Requirements

Your Google Cloud API key needs:
- Speech-to-Text API access enabled
- For V2 API: Speech-to-Text V2 API specifically enabled
- No restrictions that would prevent it from being used from your IP address

## License

This project is for testing purposes only.
